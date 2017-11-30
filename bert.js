// BERT-NODE
// Arnaud Wetzel, Inspired by bert.js of 2009 Rusty Klophaus (@rklophaus)
// Rewrite it to 
// - code and decode from node-js Buffer objects
// - handle erlang 17 maps
// - binary type is Buffer
//
// References: http://www.erlang.org/doc/apps/erts/erl_ext_dist.html#8

const Tuple = require('tuple-w');

function BertClass() {
  this.all_binaries_as_string = false;
  this.encode_string_key_as_atom = true;
  this.decode_null_values = false;
  this.convention = this.ELIXIR;
  this.output_buffer_size = 10 * 1024 * 1024; // Default is 10 MB

  this._output_buffer = null;
}

BertClass.prototype.BERT_START = 131;
BertClass.prototype.SMALL_ATOM = 115;
BertClass.prototype.ATOM = 100;
BertClass.prototype.BINARY = 109;
BertClass.prototype.SMALL_INTEGER = 97;
BertClass.prototype.INTEGER = 98;
BertClass.prototype.SMALL_BIG = 110;
BertClass.prototype.LARGE_BIG = 111;
BertClass.prototype.FLOAT = 99;
BertClass.prototype.STRING = 107;
BertClass.prototype.LIST = 108;
BertClass.prototype.SMALL_TUPLE = 104;
BertClass.prototype.LARGE_TUPLE = 105;
BertClass.prototype.NIL = 106;
BertClass.prototype.MAP = 116;
BertClass.prototype.NEW_FLOAT = 70;

BertClass.prototype.ELIXIR = 0;
BertClass.prototype.ERLANG = 1;


function BertAtom(s) {
  this.value = s || '';

  Object.defineProperty(this, 'length', {
    get: function () { return this.value.length; }
  });

  // This determines what appears in console.log()
  Object.defineProperty(this, 'inspect', {
    value: function () { return "BertAtom(" + this.value + ")"; }
  });
};
BertAtom.prototype = Object.create(String.prototype);
BertAtom.prototype.valueOf = function() { return this.value };
BertAtom.prototype.toString = BertAtom.prototype.valueOf

BertClass.atom = function(obj) {
  if (obj instanceof BertAtom) {
    return obj;
  } else {
    return new BertAtom(obj);
  }
}

// - INTERFACE -

BertClass.prototype.atom = BertClass.atom;

BertClass.prototype.encode = function(obj) {
  return Buffer.from(this.encode_nocopy(obj));
}

BertClass.prototype.encode_nocopy = function(obj) {
  if (this._output_buffer === null) {
    this._output_buffer = new Buffer(this.output_buffer_size);
    this._output_buffer[0] = this.BERT_START;
  }

  let tail_buffer = this.encode_inner(obj, this._output_buffer.slice(1));
  if (tail_buffer.length == 0) {
    throw new Error("Bert encoding buffer overflow");
  }

  return this._output_buffer.slice(0, this._output_buffer.length - tail_buffer.length);
};

BertClass.prototype.decode = function(buffer) {
  if (buffer[0] !== this.BERT_START) {
    throw ("Not a valid BERT.");
  }
  let obj = this.decode_inner(buffer.slice(1));
  if (obj.rest.length !== 0) {
    throw ("Invalid BERT.");
  }
  return obj.value;
};


// - ENCODING -

BertClass.prototype.encode_inner = function(obj, buffer) {
  let func = 'encode_' + typeof(obj);
  return this[func](obj, buffer);
};

BertClass.prototype.encode_string = function(obj, buffer) {
  if (this.convention === this.ELIXIR) {
    return this.encode_binary(new Buffer(obj), buffer);
  } else {
    buffer[0] = this.STRING;
    buffer.writeUInt16BE(obj.length, 1);
    let len = buffer.write(obj, 3);
    return buffer.slice(3 + len);
  }
};

BertClass.prototype.encode_boolean = function(obj, buffer) {
  if (obj) {
    return this.encode_inner(this.atom("true"), buffer);
  } else {
    return this.encode_inner(this.atom("false"), buffer);
  }
};

BertClass.prototype.encode_number = function(obj, buffer) {
  let isInteger = (obj % 1 === 0);

  // Handle floats...
  if (!isInteger) {
    return this.encode_float(obj, buffer);
  }

  // Small int...
  if (isInteger && obj >= 0 && obj < 256) {
    buffer[0] = this.SMALL_INTEGER;
    buffer.writeUInt8(obj, 1);
    return buffer.slice(2);
  }

  // 4 byte int...
  if (isInteger && obj >= -134217728 && obj <= 134217727) {
    buffer[0] = this.INTEGER;
    buffer.writeInt32BE(obj, 1);
    return buffer.slice(5);
  }

  // Bignum...
  let num_buffer = new Buffer(buffer.length);
  if (obj < 0) {
    obj *= -1;
    num_buffer[0] = 1;
  } else {
    num_buffer[0] = 0;
  }
  let offset = 1;
  while (obj !== 0) {
    num_buffer[offset] = obj % 256;
    obj = Math.floor(obj / 256);
    offset++;
  }
  if (offset < 256) {
    buffer[0] = this.SMALL_BIG;
    buffer.writeUInt8(offset - 1, 1);
    num_buffer.copy(buffer, 2, 0, offset);
    return buffer.slice(2 + offset);
  } else {
    buffer[0] = this.LARGE_BIG;
    buffer.writeUInt32BE(offset - 1, 1);
    num_buffer.copy(buffer, 5, 0, offset);
    return buffer.slice(5 + offset);
  }
};

BertClass.prototype.encode_float = function(obj, buffer) {
  // float...
  buffer[0] = this.NEW_FLOAT;
  buffer.writeDoubleBE(obj, 1);
  return buffer.slice(9);
};

BertClass.prototype.encode_object = function(obj, buffer) {
  // Check if it's an atom, binary, or tuple...
  if (obj === null) {
    let undefined_atom = (this.convention === this.ELIXIR) ? "nil" : "undefined";
    return this.encode_inner(this.atom(undefined_atom), buffer);
  } else if (obj instanceof Buffer) {
    return this.encode_binary(obj, buffer);
  } else if (obj instanceof Array) {
    return this.encode_array(obj, buffer);
  } else if (obj instanceof BertAtom) {
    return this.encode_atom(obj, buffer);
  } else if (obj instanceof Tuple) {
    return this.encode_tuple(obj, buffer);
  } else {
    // Treat the object as an associative array...
    return this.encode_map(obj, buffer);
  }
};

BertClass.prototype.encode_atom = function(obj, buffer) {
  buffer[0] = this.ATOM;
  const str = obj.toString();
  buffer.writeUInt16BE(str.length, 1);
  let len = buffer.write(str, 3);
  return buffer.slice(3 + len);
};

BertClass.prototype.encode_binary = function(obj, buffer) {
  buffer[0] = this.BINARY;
  buffer.writeUInt32BE(obj.length, 1);
  obj.copy(buffer, 5);
  return buffer.slice(5 + obj.length);
};

// undefined is null
BertClass.prototype.encode_undefined = function(obj, buffer) {
  return this.encode_inner(null, buffer);
};

BertClass.prototype.encode_tuple = function(obj, buffer) {
  let i;
  if (obj.length < 256) {
    buffer[0] = this.SMALL_TUPLE;
    buffer.writeUInt8(obj.length, 1);
    buffer = buffer.slice(2);
  } else {
    buffer[0] = this.LARGE_TUPLE;
    buffer.writeUInt32BE(obj.length, 1);
    buffer = buffer.slice(5);
  }
  for (i = 0; i < obj.length; i++) {
    buffer = this.encode_inner(obj[i], buffer);
  }
  return buffer;
};

BertClass.prototype.encode_array = function(obj, buffer) {
  if (obj.length == 0) {
    buffer[0] = this.NIL;
    return buffer.slice(1);
  }
  buffer[0] = this.LIST;
  buffer.writeUInt32BE(obj.length, 1);
  buffer = buffer.slice(5);
  let i;
  for (i = 0; i < obj.length; i++) {
    buffer = this.encode_inner(obj[i], buffer);
  }
  buffer[0] = this.NIL;
  return buffer.slice(1);
};

BertClass.prototype.encode_map = function(obj, buffer) {
  let keys = Object.keys(obj);
  buffer[0] = this.MAP;
  buffer.writeUInt32BE(keys.length, 1);
  buffer = buffer.slice(5);
  let i;
  for (i = 0; i < keys.length; i++) {
    const key = (this.encode_string_key_as_atom) ? this.atom(keys[i]) : keys[i];
    buffer = this.encode_inner(key, buffer);
    buffer = this.encode_inner(obj[keys[i]], buffer);
  }
  return buffer;
};



// - DECODING -

BertClass.prototype.decode_inner = function(buffer) {
  let Type = buffer[0];
  buffer = buffer.slice(1);
  switch (Type) {
  case this.SMALL_ATOM:
    return this.decode_atom(buffer, 1);
  case this.ATOM:
    return this.decode_atom(buffer, 2);
  case this.BINARY:
    return this.decode_binary(buffer);
  case this.SMALL_INTEGER:
    return this.decode_integer(buffer, 1, true);
  case this.INTEGER:
    return this.decode_integer(buffer, 4);
  case this.SMALL_BIG:
    return this.decode_big(buffer, 1);
  case this.LARGE_BIG:
    return this.decode_big(buffer, 4);
  case this.FLOAT:
    return this.decode_float(buffer);
  case this.NEW_FLOAT:
    return this.decode_new_float(buffer);
  case this.STRING:
    return this.decode_string(buffer);
  case this.LIST:
    return this.decode_list(buffer);
  case this.SMALL_TUPLE:
    return this.decode_tuple(buffer, 1);
  case this.LARGE_TUPLE:
    return this.decode_large_tuple(buffer, 4);
  case this.NIL:
    return this.decode_nil(buffer);
  case this.MAP:
    return this.decode_map(buffer);
  default:
    throw ("Unexpected BERT type: " + Type);
  }
};

BertClass.prototype.decode_atom = function(buffer, count) {
  const size = this.bytes_to_int(buffer, count);
  buffer = buffer.slice(count);
  const value = buffer.toString('utf8', 0, size);
  let result;
  if (value === "true") {
    result = true;
  } else if (value === "false") {
    result = false;
  } else if (this.decode_null_values && this.convention === this.ELIXIR && value === "nil") {
    result = null;
  } else if (this.decode_null_values && this.convention === this.ERLANG && value === "undefined") {
    result = null;
  } else {
    result = this.atom(value);
  }
  return {
    value: result,
    rest: buffer.slice(size),
  };
};

BertClass.prototype.decode_binary = function(buffer) {
  const size = this.bytes_to_int(buffer, 4);
  buffer = buffer.slice(4);
  let bin = new Buffer(size);
  buffer.copy(bin, 0, 0, size);
  return {
    value: this.all_binaries_as_string ? bin.toString() : bin,
    rest: buffer.slice(size),
  };
};

BertClass.prototype.decode_integer = function(buffer, Count, unsigned) {
  return {
    value: this.bytes_to_int(buffer, Count, unsigned),
    rest: buffer.slice(Count),
  };
};

BertClass.prototype.decode_big = function(buffer, Count) {
  let Size = this.bytes_to_int(buffer, Count);
  buffer = buffer.slice(Count);

  let isNegative, i, n, Num = 0;
  isNegative = (buffer[0] === 1);
  buffer = buffer.slice(1);
  for (i = Size - 1; i >= 0; i--) {
    n = buffer[i];
    if (Num === 0) { Num = n; } else { Num = Num * 256 + n; }
  }
  if (isNegative) { Num = Num * -1; }

  return {
    value: Num,
    rest: buffer.slice(Size),
  };
};

BertClass.prototype.decode_float = function(buffer) {
  let Size = 31;
  return {
    value: parseFloat(buffer.toString('utf8', 0, Size)),
    rest: buffer.slice(Size),
  };
};

BertClass.prototype.decode_new_float = function(buffer) {
  return {
    value: buffer.readDoubleBE(0),
    rest: buffer.slice(8),
  };
};

BertClass.prototype.decode_string = function(buffer) {
  let Size = this.bytes_to_int(buffer, 2);
  buffer = buffer.slice(2);
  return {
    value: buffer.toString('utf8', 0, Size),
    rest: buffer.slice(Size),
  };
};

BertClass.prototype.decode_list = function(buffer) {
  let Size, i, El, LastChar, Arr = [];
  Size = this.bytes_to_int(buffer, 4);
  buffer = buffer.slice(4);
  for (i = 0; i < Size; i++) {
    El = this.decode_inner(buffer);
    Arr.push(El.value);
    buffer = El.rest;
  }
  LastChar = buffer[0];
  if (LastChar !== this.NIL) {
    throw ("List does not end with NIL!");
  }
  buffer = buffer.slice(1);
  return {
    value: Arr,
    rest: buffer,
  };
};

BertClass.prototype.decode_map = function(buffer) {
  let Size, i, El, Key, Value, Map = {};
  Size = this.bytes_to_int(buffer, 4);
  buffer = buffer.slice(4);
  for (i = 0; i < Size; i++) {
    El = this.decode_inner(buffer);
    Key = El.value;
    El = this.decode_inner(El.rest);
    Value = El.value;
    Map[Key] = Value;
    buffer = El.rest;
  }
  return {
    value: Map,
    rest: buffer,
  };
};

BertClass.prototype.decode_tuple = function(buffer, count) {
  const arr = [];
  const size = this.bytes_to_int(buffer, count);
  buffer = buffer.slice(count);
  for (let i = 0; i < size; i++) {
    const el = this.decode_inner(buffer);
    arr.push(el.value);
    buffer = el.rest;
  }
  return {
    value: new Tuple(...arr),
    rest: buffer,
  };
};

BertClass.prototype.decode_nil = function(buffer) {
  // nil is an empty list
  return {
    value: [],
    rest: buffer,
  };
};

// Read a big-endian encoded integer from the first Length bytes
// of the supplied string.
BertClass.prototype.bytes_to_int = function(buffer, Length, unsigned) {
  switch (Length) {
  case 1:
    return unsigned ? buffer.readUInt8(0, true) : buffer.readInt8(0, true);
  case 2:
    return unsigned ? buffer.readUInt16BE(0, true) : buffer.readInt16BE(0, true);
  case 4:
    return unsigned ? buffer.readUInt32BE(0, true) : buffer.readInt32BE(0, true);
  }
};

// - TESTING -

// Pretty Print a byte-string in Erlang binary form.
BertClass.prototype.pp_bytes = function(Bin) {
  let i, s = "";
  for (i = 0; i < Bin.length; i++) {
    if (s !== "") {
      s += ",";
    }
    s += "" + Bin[i];
  }
  return "<<" + s + ">>";
};

// Pretty Print a JS object in Erlang term form.
BertClass.prototype.pp_term = function(obj) {
  return obj.toString();
};

BertClass.prototype.binary_to_list = function(Str) {
  let ret = [];
  for (let i = 0; i < Str.length; i++)
    ret.push(Str[i]);
  return ret;
};

module.exports = BertClass;
