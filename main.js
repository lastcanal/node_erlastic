let bert = require('./bert.js'),
  Duplex = require('stream').Duplex,
  util = require('util'),
  stdin = process.stdin,
  term_len = undefined;
bert.decode_undefined_values = false;
module.exports.buffer_len = log;

util.inherits(Port, Duplex);

function Port() { Duplex.call(this, { objectMode: true }); }
let port = new Port();

Port.prototype._read = read_term;
stdin.on('readable', read_term);
stdin.on('end', process.exit);

function read_term() {
  if (term_len === undefined) {
    const term_bin = stdin.read(4);
    if (null !== term_bin) {
      term_len = bert.bytes_to_int(term_bin, 4, true);
    }
  }

  if (term_len !== undefined) {
    const term = stdin.read(term_len);
    if (null !== term) {
      term_len = undefined;
      port.push(bert.decode(term));
    }
  }
}

let stdout_write = process.stdout.write;
let fake_write = function() {};
process.stdout.write = fake_write;
Port.prototype._write = function(obj, encoding, callback) {
  let term = bert.encode(obj, true);
  let len = new Buffer(4); len.writeUInt32BE(term.length, 0);
  process.stdout.write = stdout_write;
  process.stdout.write(len);
  process.stdout.write(term, callback);
  process.stdout.write = fake_write;
};

function log(mes) {
  if (typeof(mes) != 'string') mes = JSON.stringify(mes);
  process.stderr.write((new Date()).toString().substring(4, 24) + " " + mes + "\n");
}

function server(handler, init) {
  let state, first = true, state_lock = false;

  function send_response(type, arg1, arg2) {
    if (type === "reply") {
      port.write(arg1);
    } else if ((type === "reply" && arg2 !== undefined) || (type === "noreply" && arg1 !== undefined)) {
      state = (arg2 === undefined) ? arg1 : arg2;
    } else if (type === 'error') {
      port.write(
        bert.tuple(
          bert.atom('error'),
          bert.tuple(
            bert.atom(arg1.type || 'user'),
            (arg1.code || 0),
            arg1.name,
            arg1.message,
            [arg1.stack]
          )
        )
      );
    }
  }

  port.on('readable', function next_term() {
    if (state_lock) { return; }
    const term = port.read();
    if (null !== term) {
      state_lock = true;
      if (first) {
        state = (init) ? init(term) : term; // first term is initial state
        first = false;
        state_lock = false;
        next_term();
      } else {
        try {
          handler(term, function(term) { port.write(term); }, state, send_response);
        } catch (e) {
          send_response("error", e);
        }

        state_lock = false;
        next_term();
      }
    }
  });
}
module.exports.port = port;
module.exports.server = server;
module.exports.log = log;
