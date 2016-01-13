(function() {

  var MSB = 0x80
      , REST = 0x7F
      , MSBALL = ~REST
      , INT = Math.pow(2, 31);

  var _ = require('underscore');
  var f = require('./functional');
  var utils = require('./utils');

  var logger = utils.logger('codec');

  exports.encodeUByte = f.lift(doEncodeUByte, _.identity);
  exports.encodeVInt = f.lift(doEncodeVInt, _.identity);
  exports.encodeVLong = f.lift(doEncodeVLong, _.identity);
  exports.encodeObject = f.lift(doEncodeObject, _.identity);
  exports.encodeBytes = f.lift(doEncodeBytes, _.identity);
  exports.encodeString = f.lift(doEncodeString, _.identity);

  exports.decodeUByte = f.lift(doDecodeUByte, _.identity);
  exports.decodeVInt = f.lift(doDecodeVInt, _.identity);
  exports.decodeVLong = f.lift(doDecodeVLong, _.identity);
  exports.decodeObject = f.lift(doDecodeObject, _.identity);
  exports.decodeBytes = f.lift(doDecodeBytes, _.identity);

  exports.lastDecoded = function(values, state) {
    return values[0];
  };

  exports.allDecoded = function(values, state) {
    return values;
  };

  exports.bytesEncoded = function(values, state) {
    // If buffer is too big, slice it up so that it can be sent
    // immediately without any further modifications.
    var bytes = values[values.length - 1];
    if (bytes < state.buf.length)
      state.buf = state.buf.slice(0, bytes);

    return bytes;
  };

  function doEncodeUByte(bytebuf, num) {
    return _.compose(updateEncOffset(bytebuf), checkedWriteUByte(bytebuf))(num);
  }

  function doEncodeVInt(bytebuf, num) {
    return _.compose(updateEncOffset(bytebuf), checkedWriteVInt(bytebuf))(num);
  }

  function doEncodeVLong(bytebuf, num) {
    return _.compose(updateEncOffset(bytebuf), checkedWriteVLong(bytebuf))(num);
  }

  function doEncodeObject(bytebuf, obj, clientOpts) {
    return _.compose(updateEncOffset(bytebuf), checkedWriteObject(bytebuf, clientOpts))(obj);
  }

  function doEncodeString(bytebuf, obj) {
    return _.compose(updateEncOffset(bytebuf), checkedWriteString(bytebuf))(obj);
  }

  function doEncodeBytes(bytebuf, bytes) {
    return _.compose(updateEncOffset(bytebuf), checkedWriteBytes(bytebuf))(bytes);
  }

  var nullCheck = f.validator('must not be null', f.existy);
  var number = f.validator('must be a number', _.isNumber);
  var positiveOrZero = f.validator('must be >= 0', f.greaterThan(-1));
  var intTooBig = f.validator('must be less than 2^31', f.lessThan(Math.pow(2, 31)));
  var longTooBig = f.validator('must be less than 2^53 (javascript safe integer limitation)',
                               f.lessThan(Math.pow(2, 53)));
  var stringOrNullCheck = f.validator('must be a String or null', stringOrNull);

  function stringOrNull(x) {
    return !f.existy(x) || _.isString(x);
  }

  function checkedWriteUByte(bytebuf) {
    return f.partial1(f.condition1(number, positiveOrZero), uncheckedWriteUByte(bytebuf));
  }

  function checkedWriteVInt(bytebuf) {
    return f.partial1(f.condition1(number, positiveOrZero, intTooBig), uncheckedWriteVNum(bytebuf));
  }

  function checkedWriteVLong(bytebuf) {
    return f.partial1(f.condition1(number, positiveOrZero, longTooBig), uncheckedWriteVNum(bytebuf));
  }

  function checkedWriteObject(bytebuf, clientOpts) {
    return f.partial1(f.condition1(nullCheck), uncheckedWriteObject(bytebuf, clientOpts));
  }

  function checkedWriteString(bytebuf) {
    return f.partial1(f.condition1(stringOrNullCheck), uncheckedWriteString(bytebuf));
  }

  function checkedWriteBytes(bytebuf) {
    return f.partial1(f.condition1(nullCheck), uncheckedWriteBytes(bytebuf));
  }

  function updateEncOffset(bytebuf) {
    return function(offset) {
      bytebuf.offset = offset;
      return offset;
    }
  }

  function uncheckedWriteUByte(bytebuf) {
    return function(byte) {
      bytebuf = bytebufOverflowProtect(bytebuf, 1);
      // TODO: We can better control validation, e.g. no boundary check but double size, so try passing noAssert=true
      bytebuf.buf.writeUInt8(byte, bytebuf.offset);
      return bytebuf.offset + 1;
    }
  }

  // TODO: Should create an ByteBuf type and move this logic there
  function bytebufOverflowProtect(bytebuf, maxSize) {
    if (bytebuf.offset + maxSize > bytebuf.buf.length) {
      var length = bytebuf.buf.length * 2;
      while (length < bytebuf.offset + maxSize)
        length = length * 2;

      var tmp = new Buffer(length);
      bytebuf.buf.copy(tmp, 0, 0, bytebuf.buf.length);
      bytebuf.buf = tmp;
      return bytebuf;
    }
    return bytebuf;
  }

  function uncheckedWriteVNum(bytebuf) {
    return function(num) {
      // Resize if not enough space to fit the biggest of var nums.
      // Due to Javascript limitations, the biggest var num is 2 ^ 53 - 1,
      // so at most 8 bytes will be needed.
      bytebuf = bytebufOverflowProtect(bytebuf, 8);

      var localOffset = bytebuf.offset;

      while(num >= INT) {
        bytebuf.buf.writeUInt8((num & 0xFF) | MSB, localOffset++);
        num /= 128
      }
      while(num & MSBALL) {
        bytebuf.buf.writeUInt8((num & 0xFF) | MSB, localOffset++);
        num >>>= 7
      }
      bytebuf.buf.writeUInt8(num | 0, localOffset);

      return localOffset + 1;
    }
  }

  function isProtobuf(clientOpts) {
    return _.has(clientOpts, 'protobuf') && f.thuthy(clientOpts['protobuf']);
  }

  function uncheckedWriteObject(bytebuf, clientOpts) {
    return function(obj) {
      if (isProtobuf(clientOpts)) {
        var ProtoByteBuffer = require('bytebuffer');
        var buf = obj.toBuffer();
        var offsetAfterLength = uncheckedWriteVNum(bytebuf)(buf.length);
        buf.copy(bytebuf.buf, offsetAfterLength);
        return offsetAfterLength + buf.length;
      } else {
        if (_.isString(obj)) {
          var stringNumBytes = Buffer.byteLength(obj);
          var offsetAfterBytes = uncheckedWriteVNum(bytebuf)(stringNumBytes);
          bytebuf = bytebufOverflowProtect(bytebuf, stringNumBytes);
          return bytebuf.buf.write(obj, offsetAfterBytes) + offsetAfterBytes;
          //} else if (obj instanceof Buffer) {
          //  var offsetAfterLength = uncheckedWriteVNum(bytebuf)(obj.length);
          //  obj.copy(bytebuf.buf, offsetAfterLength);
          //  return offsetAfterLength + obj.length;
        } else {
          throw new Error('Not handled yet: ' + obj);
        }
      }
    }
  }

  function uncheckedWriteString(bytebuf) {
    return function(obj) {
      var stringNumBytes = f.existy(obj) ? Buffer.byteLength(obj) : 0;
      var offsetAfterBytes = uncheckedWriteVNum(bytebuf)(stringNumBytes);
      if (stringNumBytes > 0) {
        bytebuf = bytebufOverflowProtect(bytebuf, stringNumBytes);
        return bytebuf.buf.write(obj, offsetAfterBytes) + offsetAfterBytes;
      }
      return offsetAfterBytes;
    }
  }

  function uncheckedWriteBytes(bytebuf) {
    return function(bytes) {
      bytebuf = bytebufOverflowProtect(bytebuf, bytes.length);
      var targetStart = bytebuf.offset;
      bytes.copy(bytebuf.buf, targetStart);
      return targetStart + bytes.length;
    }
  }

  function doDecodeUByte(bytebuf) {
    return uncheckedReadUByte(bytebuf)();
  }

  function doDecodeVInt(bytebuf) {
    return uncheckedReadVNum(bytebuf)();
  }

  function doDecodeVLong(bytebuf) {
    return uncheckedReadVNum(bytebuf)();
  }

  function doDecodeObject(bytebuf, clientOpts) {
    return uncheckedReadObject(bytebuf, clientOpts)();
  }

  function doDecodeBytes(bytebuf, num) {
    return uncheckedReadBytes(bytebuf)(num);
  }

  function uncheckedReadUByte(bytebuf) {
    return function() {
      return bytebuf.buf.readUInt8(bytebuf.offset++);
    }
  }

  function uncheckedReadVNum(bytebuf) {
    return function() {
      var res = 0, shift  = 0, b;

      do {
        b = bytebuf.buf.readUInt8(bytebuf.offset++);
        res += shift < 28
            ? (b & REST) << shift
            : (b & REST) * Math.pow(2, shift);
        shift += 7;
      } while (b >= MSB);

      return res
    }
  }

  function uncheckedReadBytes(bytebuf) {
    return function(num) {
      var end = bytebuf.offset + num;
      var bytes = bytebuf.buf.slice(bytebuf.offset, end);
      bytebuf.offset = end;
      return bytes;
    }
  }

  function uncheckedReadObject(bytebuf, clientOpts) {
    return function() {
      var numBytes = uncheckedReadVNum(bytebuf)();
      if (numBytes > bytebuf.buf.length - bytebuf.offset) {
        logger.tracef('Can not fully read object with %d bytes (buffer size is %d, buffer offset %d)',
                      numBytes, bytebuf.buf.length, bytebuf.offset);
        return undefined;
      }

      if (isProtobuf(clientOpts)) {
        var buf = bytebuf.buf.slice(bytebuf.offset, bytebuf.offset + numBytes);
        bytebuf.offset = bytebuf.offset + numBytes;
        var ProtoByteBuffer = require("bytebuffer");
        var protobufByteBuf = new ProtoByteBuffer(buf.length);
        protobufByteBuf.append(buf);
        protobufByteBuf.flip();
        return protobufByteBuf;
      } else {
        var obj = bytebuf.buf.toString(undefined, bytebuf.offset, bytebuf.offset + numBytes);
        bytebuf.offset = bytebuf.offset + numBytes;
        return obj;
      }
    }
  }

}.call(this));
