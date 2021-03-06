node_erlastic
=============

Node library to make nodejs gen_server in Erlang/Elixir through Port connection.

This module allows you to :
- decode and encode between Binary Erlang Term and javascript types
- create a simple Erlang port interface through a nodeJS *Readable* and *Writable* (Duplex)
- create a "`gen_server` style" handler to manage your port

## Example Usage

Before going through details, lets take an example, write an account
manager server, where you can add or remove an amount in the
account and get it :

```javascript
require('node_erlastic').server(
  function(term, from, current_amount, done) {
    // Responds with current_amount, leaves state unchanged.
    // (Pass another argument to done to update the state)
    if (term == "get") return done("reply", current_amount);

    // Updates the current state without responding
    if (term[0] == "add") return done("noreply", current_amount+term[1]);
    if (term[0] == "rem") return done("noreply", current_amount-term[1]);

    // Exceptions cause an error response
    throw new Error("unexpected request")
  },
  function() {
    // Initial state
    return 0;
  },
);
```

```elixir
GenServer.start_link(Exos.Proc,{"node calculator.js", [], cd: "/path/to/proj"}, name: Calculator)
GenServer.cast Calculator, {:add, 2}
GenServer.cast Calculator, {:add, 3}
GenServer.cast Calculator, {:rem, 1}
4 = GenServer.call Calculator, :get
{:error, {type, code, name, message, stack}} = GenServer.call Calculator, {:unknown_command}

defmodule Exos.Proc do
  use GenServer
  def init({cmd,init,opts}) do
    port = Port.open({:spawn,'#{cmd}'}, [:binary,:exit_status, packet: 4] ++ opts)
    send(port,{self,{:command,:erlang.term_to_binary(init)}})
    {:ok,port}
  end
  def handle_info({port,{:exit_status,0}},port), do: {:stop,:normal,port}
  def handle_info({port,{:exit_status,_}},port), do: {:stop,:port_terminated,port}
  def handle_info(_,port), do: {:noreply,port}
  def handle_cast(term,port) do
    send(port,{self,{:command,:erlang.term_to_binary(term)}})
    {:noreply,port}
  end
  def handle_call(term,_reply_to,port) do
    send(port,{self,{:command,:erlang.term_to_binary(term)}})
    res = receive do {^port,{:data,b}}->:erlang.binary_to_term(b) end
    {:reply,res,port}
  end
end
```

## External Term Format codec (BERT)

```javascript
var Bert = require('node_erlastic/bert');
var bert = new Bert();

// you can configure `convention`, `all_binaries_as_string` , `encode_string_key_as_atom`, etc., see below
bert.convention = Bert.ELIXIR;
bert.all_binaries_as_string = true;

var buf = bert.encode([1,2,3,4]);
var arr = bert.decode(buf);

// encode_nocopy is faster, but uses a shared buffer, i.e. a second call to encode_nocopy will clobber the
// value returned by the first call
var bufDanger = bert.encode_nocopy({foo: "bar", k2: 4},true);
```

`Bert.decode` and `Bert.encode` use a nodejs `Buffer` object
containing the binary erlang term, converted using the following rules :

(PROBABLY A BAD IDEA???)
- erlang atom `foobar` becomes an instance of the String-like class BertAtom
  - create new atoms with `bert.atom('foo')`
  - js objects cannot have BertAtom keys, trying it will coerce the keys to plain strings
  - however, see `bert.encode_string_key_as_atom` below
- erlang list is js array
- erlang tuple `{a,b}` is Tuple object from [the tuple-w library](https://github.com/Olical/tuple)
  - the Tuple object allows you to access elements by index, like an array
  - create new Tuples with `new Tuple()`, e.g. `new Tuple('foo', 1, 'bar', 2)`
- erlang integer is js integer
- erlang float is js float
- other js objects are erlang maps
  - erlang atom keys are converted to js strings during decoding
  - js string keys are converted to erlang atom if `bert.encode_string_key_as_atom == true` (default is `false`)
  - js symbol keys cannot be converted to atoms if they are not in the symbol registry
- erlang binary is nodejs "Buffer"
  - but converted into string if `bert.all_binaries_as_string`
- js string is
  - UTF8 erlang binary if `bert.convention == Bert.ELIXIR`
  - erlang character list if `bert.convention == Bert.ERLANG`
- js boolean are `true` and `false` atoms
- js null and undefined are
  - `nil` atom if `bert.convention == Bert.ELIXIR`
  - `undefined` atom if `bert.convention == Bert.ERLANG`
  - but, if `bert.decode_undefined_values == false`, then `nil` and `undefined` are
    decoded into atom instead of null

## The Port Duplex

Port provides you a Node Duplex stream in object mode which is both Readable
and Writable : http://nodejs.org/api/stream.html#stream_class_stream_duplex_1
Through this duplex, you can communicate javascript objects with an erlang node
through stdin/out with `port.read()` and `port.write(obj)`.  These objects are
converted to erlang external binary format using the Bert encoder described
above.

**Need `{packet,4}` `openport` option on the erlang side**

Below a simple "echo" server using this abstraction, read nodejs
"readable" documentation to understand it :

```javascript
var port = require('node_erlastic').port;
port.on('readable', function echo(){
  if(null !== (term = port.read())){
    port.write(term);
    echo();
  }
});
```

```elixir
port = Port.open({:spawn,'node calculator.js'}, [:binary, packet: 4])
send(port,{self,{:command,:erlang.term_to_binary( {:hello, 007} )}})
{:hello, 007} = receive do {^port,{:data,b}}->:erlang.binary_to_term(b) end
send(port,{self,{:command,:erlang.term_to_binary( [:foo, :bar]} )}})
[:foo, :bar] = receive do {^port,{:data,b}}->:erlang.binary_to_term(b) end
```

## The Erlang style handler interface to the port event handler

For convenience, you can use the `server` function to react to the
port events in the same fashion as the erlang gen server handler.

It takes as parameter a handler function taking `(req_term,from,state,done)` parameters.
To "unlock" state and continue to read request mailbox (equivalent of the
return of the erlang `gen_server handle_*` function), you need to call `done`.

```javascript
done("noreply",newstate); 
done("noreply");
done("reply",reply_term,newstate);
done("reply",reply_term);
```

Like in erlang, your handler can unlock the state before it replies
to the call:

```javascript
done("noreply",newstate);
// then in some callback
from(myreply);
```

Before sending request, the first message from the port will be
used to define the initial state. However, if you pass an init function as the second argument to `server()`, then that function's return value will be the initial state instead. The init function will be called with two arguments: the initial message term from the port, and the instance of BertClass to configure encoding/decoding.

Please see the beginning of this README to find a complete example.

## Log function

The port stderr is directly output into the erlang stdout, this library
provides a convenient `log` function allowing you to log something from your
node server.

```javascript
  var log = require("node_erlastic").log;
  log("your log");
```
