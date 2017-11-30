require('./../main.js').server(
  function(term, from, current_amount, done) {
    term.unpack((command, argument) => {
      switch (command.toString()) {
        case "get": return done("reply", current_amount);
        case "add": return done("noreply", current_amount + argument);
        case "rem": return done("noreply", current_amount - argument);
        default: throw new Error("unexpected request");
      }
    });
  },
  function() {
    return 0;
  }
);

