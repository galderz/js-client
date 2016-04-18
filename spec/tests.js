var t = require('./utils/testing'); // Testing dependency

exports.iterateEntries = function(prefix, client) {
  return function(done) {
    var pairs = [
      {key: prefix + '-it1', value: 'v1', done: false},
      {key: prefix + '-it2', value: 'v2', done: false},
      {key: prefix + '-it3', value: 'v3', done: false}];
    client
      .then(t.assert(t.putAll(pairs), t.toBeUndefined))
      .then(t.parIterator(1, pairs)) // Iterate all data, 1 element at time, parallel
      .then(t.seqIterator(3, pairs)) // Iterate all data, 3 elements at time, sequential
      .catch(t.failed(done))
      .finally(done);
  }
};