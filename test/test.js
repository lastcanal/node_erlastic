let port = require('./../main.js').port,
  state = null;

port.on('readable', function echo() {
  const term = port.read();
  if (null !== term) {
    if (state === null) state = term;
    else port.write(term);
    echo();
  }
});
