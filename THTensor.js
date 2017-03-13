'use strict';

var assert = require('assert');
var utils = require('./utils.js');

var ffi = require('ffi')
var ref =  require('ref')
var THType = "Float" // supports Floats by default

var ffith = require('/Users/jpchen/jstorch/torch.js/TH.js')
var TH = ffith.TH

var arr_to_ls = function(dims){
  var dimension = 0;
  var size = TH.THLongStorage_newWithSize(dims.length).deref();
  TH.THLongStorage_fill(size.ref(), 0)
  for(var i=0; i < dims.length; i++) {
    TH.THLongStorage_set(size.ref(), i, dims[i]);
  }
  return size;
}

Tensor.ls_to_array = function(ls) {
  var dims = []
  for(var i=0; i < ls.size; i++){
    dims.push(TH.THLongStorage_get(ls.ref(), i));
  }
  return dims
}

var f_arr_prod = function(dims) {
    var prod = 1;
    for(var i=0; i < dims.length; i++) {
        prod *= dims[i];
        // if (i%1000==0){
        //   global.gc()
        // }
      }
    return prod;
}

// Can swap out different backing stores
// function TypedArrayBackingStore(ArrayType) {
//     return {
//         new: function(n) { return new ArrayType(n); },
//         set: function(tgt, src, offset) {
//             tgt.set(src, offset);
//         }
//     }
// }

Tensor.prototype.override = function(t_data, dims, ttype) {
  this.dims = dims || Tensor.ls_to_array(TH.THFloatTensor_newSizeOf(t_data.ref()).deref());
  this.length = f_arr_prod(this.dims);
  this.data = t_data;
  if (ttype === "Byte")
    this.ref = this.data.ref;
  else {
    this.ref = this.data.ref();
  }
}

var ArrayBackingStore = {
    ArrayType: Array,
    new: function(n) {
        var a = new Array(n);
        while (n--) { a[n] = 0; }
        return a;
    },
    set: function(tgt, src, offset) {;
        for (var i = 0; i < src.length; i++) {
            tgt[i+offset] = src[i];
        }
   o }
};

// The actual backing store we're using
// var BackingStore = TypedArrayBackingStore(Float64Array);

function Tensor(dims) {
  if(!Array.isArray(dims))
    throw new Error("Tensor must have an array provided for construction");

  var size = arr_to_ls(dims)
  var prod = f_arr_prod(dims)
  this.dims = dims;
  this.length = prod

  // var tensor = THTensor.newWithSize1d(prod).deref();
  var tensor = TH.THFloatTensor_newWithSize(size.ref(), ref.NULL).deref();
  this.data = tensor;
  this.ref = this.data.ref()
  this.type = THType;
  return this;
}


//original tensor
// function Tensor(dims) {
//     if(!Array.isArray(dims))
//     throw new Error("Tensor must have an array provided for construction");
//     this.dims = dims;
//     var size = 1;
//     var n = dims.length;
//     while (n--) size *= dims[n];
//     this.length = size;
//     this.data = BackingStore.new(size);
// }

Object.defineProperties(Tensor.prototype, {
    rank: { get: function() { return this.dims.length; } },
});

Tensor.prototype.reshape = function(dims) {
  var size = f_arr_prod(dims)
  assert(size === this.length, 'Tensor reshape invalid size');
  this.dims = dims;
  this.data = this.view(dims);
  this.ref = this.data.ref();
  return this
}

Tensor.prototype.view = function(dims) {
  var rsize = arr_to_ls(dims);
  var nt = TH.THFloatTensor_new().deref()
  // console.log("orig", orig)
  TH.THFloatTensor_set(nt.ref(), this.data.ref()) //orig.storage, orig.storageOffset, rsize.ref())
  return nt;
}

Tensor.prototype.fill = function(val) {
    TH.THFloatTensor_fill(this.ref, val);
    return this;
};

Tensor.prototype.zero = function() {
    return this.fill(0);
};

// Adapted from:
//    https://github.com/karpathy/convnetjs/blob/master/src/convnet_vol.js
Tensor.prototype.fillRandom = function() {
    var scale = 1/this.length;
    return this.applyFn(function(val) {
      return utils.gaussianSample(0, scale);
 });
    // var n = this.length;
    // while (n--){
    //    this.data[n] = utils.gaussianSample(0, scale);
    // }
    // return this;
}

Tensor.prototype.copy = function(other, offset) {
    offset = offset || 0;
    var tensor_to_copy = other.data
    var ttype = other.type

    if(offset != 0)
      throw new Error("Offset copying not yet supported")

    // TODO: erroring wrong size
    //TH.THFloatTensor['copy' + ttype](this.data.ref(), other.data.ref())
    TH.THFloatTensor_copyFloat(this.data.ref(), other.data.ref());
    return this;
};

// Slow Copy of array 
Tensor.prototype.slowCopy = function(other) {
    this.fromArray(other.toArray());
    return this;
};

Tensor.prototype.clone = function() {
    var copy = new Tensor(this.dims);
    //TEMP
    return copy.slowCopy(this);
    return copy.copy(this);
};

// Make this Tensor refer to the same backing store as other
Tensor.prototype.refCopy = function(other) {
    this.dims = other.dims;
    this.length = other.length;
    this.data = other.data;
    this.ref = this.data.ref();
    this.type = other.type;
    return this;
}

// Create a new Tensor object that refers to the same backing store
//    as this Tensor object
Tensor.prototype.refClone = function() {
    var t = Object.create(Tensor.prototype);
    return t.refCopy(this);
};

Tensor.arr_is_equal = function(a,b) {
  if(a.length != b.length)
    return false
  for(var i=0; i < a.length; i++)
    if(a[i] != b[i])
      return false

  return true
}

Tensor.prototype.assert_size_equal = function(other, assert_msg) {
  if(typeof(other) == "number")
    return true;
  else {
    var are_equal = Tensor.arr_is_equal(other.dims, this.dims);
    assert.ok(are_equal, assert_msg);
    return are_equal;
  }
}

// Gets or sets values of tensor, determined by the val_or_tensor arg
Tensor.get_set = function(js_tensor, coords, val_or_tensor) {
  var ndims = js_tensor.rank;
  var dfinal = ndims
  var cdim = 0;

  var o_tensor = js_tensor.data
  var tensor = TH.THFloatTensor_newWithTensor(o_tensor.ref()).deref();
  for(var dim = 0; dim < dfinal; dim++) {
    var pix = coords[dim]
    if(!Array.isArray(pix)) {
      pix = Math.floor(pix);
      if (pix < 0)
        pix = tensor.size[cdim] + pix + 1;
      if(!((pix >= 0) && (pix < tensor.size[cdim])))
        throw new Error("Index out of bounds.");
      if(ndims == 1){
        // Setting element
        if (val_or_tensor != undefined){
          if (typeof(val_or_tensor) != "number")
            throw new Error("Value being set needs to be number.");
          TH.THFloatStorage_set(tensor.storage, tensor.storageOffset+pix*tensor.stride[0], val_or_tensor);
          return;
        }
        else{
          var rval = TH.THFloatStorage_get(tensor.storage, tensor.storageOffset+pix*tensor.stride[0]);
          return rval;
        }
      }
      else {
        TH.THFloatTensor_select(tensor.ref(), ref.NULL, cdim, pix);
        ndims = TH.THFloatTensor_nDimension(tensor.ref());
      }
    }
    else if(typeof(pix) != "number") {
      // SAfety check
      tensor = null;
      throw new Error("Tensor index must be an Int or an Array of ints.");
    }
    else {
      //Array
      var ixarray = pix;
      var start = 0;
      var end = tensor.size[cdim]-1;
      if(ixarray.length > 0) {
        start = ixarray[0];
        end = start;
      }

      if(start < 0)
        start = tensor.size[cdim] + start + 1;
      if(!((start >= 0) && (start < tensor.size[cdim])))
        throw new Error("Index out of bounds");
      if(ixarray.length > 1)
        end = ixarray[1];
      if(end < 0)
        end = tensor.size[cdim] + end + 1;
      if(!((end >= 0) && (end < tensor.size[cdim])))
        throw new Error("Index out of bounds");
      if(end < start)
        throw new Error("Starting index cannot be after End.");
      TH.THFloatTensor_narrow(tensor.ref(), ref.NULL, cdim++, start, end-start+1);
      ndims = TH.THFloatTensor_nDimension(tensor.ref());
    }
  }
  // copy from the tensor value
  if (val_or_tensor) {
    //THFloatTensor['copy' + val_or_tensor.type](tensor.ref(), val_or_tensor.data.ref())
    TH.THLongStorage_copyFloat(tensor.ref(), val_or_tensor.data.ref());
  }
  return tensor;
}

// These are slow; don't use them inside any hot loops (i.e. they're good for
//    debgugging/translating data to/from other formats, and not much else)
Tensor.prototype.get = function(coords) {
  if(coords.length > this.dims.length)
    throw new Error("Dimensions exceeded rank")
  var tensor = Tensor.get_set(this, coords)

  if(tensor == undefined || typeof(tensor) == "number")
    return tensor
  else {
    var tt_ref = this.refClone()
    tt_ref.override(tensor)
    return tt_ref
  }
};

Tensor.prototype.set = function(coords, val) {
  // val is a scalar or a tensor
  var tensor = Tensor.get_set(this, coords, val);
  if(tensor == undefined)
    return tensor;
  // create a reference to tensor
  var tt_ref = this.refClone();
  tt_ref.override(tensor);
  return tt_ref;
};

Tensor.create_empty_of_size = function(ts, TensorType) {
  //Supporting floats for now.
  //TensorType = TensorType || THFloatTensor
  return TH.THFloatTensor_newWithSize(Tensor.getSize(ts, TensorType).ref(), ref.NULL).deref()
}

Tensor.getSize = function(ts, TensorType) {
    // Supporting floats for now
    //TensorType = TensorType || THFloatTensor
    return TH.THFloatTensor_newSizeOf(ts).deref()
}

Tensor.prototype.size = function(ix) {
    if(ix != undefined)
        return TH.THFloatTensor_size(this.data.ref(), ix);
    else
        return Tensor.ls_to_array(Tensor.getSize(this.data.ref()));
};

Tensor.byte_sizeof = function(sz, ttype) {
  var bempty = TH.THByteTensor_newWithSize(sz.ref(), ref.NULL).deref();
  // console.log("empty in habitat: ", bempty)
  return bempty;
  //return {empty: bempty};
}

Tensor.byte_nonzero = function(ts, ttype) {
  var sz = Tensor.getSize(ts.ref());
  var tempty = TH.THFloatTensor_newWithSize(sz.ref(), ref.NULL).deref();
  TH.THFloatTensor_zero(tempty.ref());
  var bempty = Tensor.byte_sizeof(sz, ttype);

  // fill byte tensor with not equals
  TH.THFloatTensor_neTensor(bempty.ref(), tempty.ref(), ts.ref())
  return TH.THByteTensor_sumall(bempty.ref())
}

Tensor.byte_comparison = function(byte_comp_fct) {
  return function(adata, bdata, not_in_place, mval){
    assert.ok(not_in_place, "Cannot compare in-place equality");
    var sz = Tensor.getSize(adata.data.ref());
    var method = "THFloatTensor_" + byte_comp_fct;
    var tcompare = TH.THFloatTensor_newWithSize(sz.ref(), ref.NULL).deref();;
    TH.THFloatTensor_fill(tcompare.ref(), bdata);
    if (typeof(bdata) != "number") {
      assert.ok(adata.type === bdata.type, "Checking tensor equal must be of same tensor type");
    }

    var bempty = Tensor.byte_sizeof(sz, adata.type);
    TH[method](bempty.ref(), adata.data.ref(), tcompare.ref());

    var bb = adata.refClone();
    bb.type = "Byte";
    bb.override(bb, adata.dims.slice(0), bb.type);
    return bb;
  }
}

Tensor.prototype.sum = function(ix) {
  if(ix == undefined || ix == null)
    return TH.THFloatTensor_sumall(this.ref);
  else{
    throw new Error("Sum across dimension not yet supported");
  }
}
Tensor.prototype.sumreduce = Tensor.prototype.sum

Tensor.prototype.min = function() {
  return TH.THFloatTensor_minall(this.data.ref());
}
Tensor.prototype.minreduce = Tensor.prototype.min;

Tensor.prototype.max = function() {
  return TH.THFloatTensor_maxall(this.data.ref());
}
Tensor.prototype.maxreduce = Tensor.prototype.max;

Tensor.prototype.all = function() {
  return Tensor.byte_nonzero(this.data, this.type) == this.length;
}
Tensor.prototype.allreduce = Tensor.prototype.all;

Tensor.prototype.any = function() {
  return Tensor.byte_nonzero(this.data, this.type) > 0;
}
Tensor.prototype.anyreduce = Tensor.prototype.any;

Tensor.prototype.mod = function() {
  throw new Error("Mod not supported in torch, ergo no support yet.");
}

Tensor.prototype.modeq = function() {
  throw new Error("Mod not supported in torch, ergo no support yet.");
}

Tensor.atan2 = function(adata, bdata, not_in_place, mval) {
  mval = mval || 1;
  var end_ref = adata.data;

  if(not_in_place)
    end_ref = Tensor.create_empty_of_size(adata.data.ref());

  if(typeof(bdata) == "number"){
    TH.THFloatTensor_add(end_ref.ref(), adata.data.ref(), bdata);
    bdata = {data: Tensor.create_empty_of_size(adata.data.ref())};
    TH.THFloatTensor_fill(bdata.data.ref(), bdata)
  }

  TH.THFloatTensor_atan2(end_ref.ref(), adata.data.ref(), bdata.data.ref())

  return end_ref
}

function toArrayRec(tensor, coords) {
    if (coords.length === tensor.rank) {
        return tensor.get(coords);
    } else {
        var dim = coords.length;
        var arr = [];
        for (var i = 0; i < tensor.dims[dim]; i++) {
            arr.push(toArrayRec(tensor, coords.concat([i])));
        }
        return arr;
    }
}

Tensor.prototype.toFlatArray = function () {
    var arr = [];
    if (this.rank === 1) {
      for (var i=0; i < this.dims[0]; ++i) {
        arr.push(TH.THFloatTensor_get1d(this.data.ref(), i));
      }
      return arr;
    }
    else if (this.rank === 2) {
      for (var i=0; i < this.dims[0]; ++i) {
        for (var j=0; j < this.dims[1]; ++j) {
          arr.push(TH.THFloatTensor_get2d(this.data.ref(), i, j));
        }
      }
      return arr;
    }
    throw new Error('Tensors must have rank = 1 or 2');
}

Tensor.prototype.toArray = function() {
    return toArrayRec(this, []);
};

function fromArrayRec(tensor, coords, x) {
    if (!(x instanceof Array)) {
        tensor.set(coords, x);
    } else {
        var dim = coords.length;
        for (var i = 0; i < tensor.dims[dim]; i++) {
            fromArrayRec(tensor, coords.concat([i]), x[i]);
        }
    }
}
Tensor.prototype.fromArray = function(arr) {
    if (arr.length != this.dims[0])
      throw new Error('Array length must match with tensor length');
    fromArrayRec(this, [], arr);
    return this;
};

Tensor.prototype.toString = function() {
    return this.toArray().toString();
};

// Tensor.prototype.toFlatArray = function() {
//     return Array.prototype.slice.call(this.data);
// }
Tensor.prototype.fromFlatArray = function(arr) {
    BackingStore.set(this.data, arr, 0);
    return this;
}

Tensor.prototype.applyFn = function (cb) {
  //eventually take any tensor type passed in
  var callback = ffi.Callback('float', ['float'], cb);
  TH.THFloatTensor_fctapply(this.data.ref(), callback);
  return this;
}

function addUnaryMethod(name) {
    //need to differentiate between in-place and non in-place operations
    Tensor[name] = new Function('TH', 'Tensor', [
    'return function(adata, notinplace) {',
    'var end_ref = adata.data',
    'if (notinplace) {',
      'end_ref = Tensor.create_empty_of_size(adata.data.ref())',
    '}',
    // operation in place please
    'TH.THFloatTensor_' + name + '(end_ref.ref(), adata.data.ref())',
    'return end_ref; }'
  ].join('\n'))(TH, Tensor);
    // var fneq = new Function([
    //     'var n = this.data.length;',
    //     'while (n--) {',
    //     '   var x = this.data[n];',
    //     '   this.data[n] = ' + fncode + ';',
    //     '}',
    //     'return this;'
    // ].join('\n'));
    // Tensor.prototype[name + 'eq'] = fneq;
    // Tensor.prototype[name] = function() {
    //     var nt = this.clone();
    //     return fneq.call(nt);
    // };
}

function addUnaryPrototype(name){
  // Use method generated in addUnaryMethod()
  var fn_inplace = new Function('Tensor', [
      'return function(){',
      'Tensor.' + name + '(this, false)',
      'return this; }'
  ].join('\n'))(Tensor);
  //clone if not in-place
  var fn_notinplace = new Function('Tensor', [
      'return function() {',
      'var atensor = Tensor.' + name + '(this, true)',
      'var cc = this.refClone()',
      'cc.override(atensor, this.dims.slice(0))',
      'return cc }'
  ].join('\n'))(Tensor);

  Tensor.prototype[name + 'eq'] = fn_inplace;
  Tensor.prototype[name] = fn_notinplace
}

function addOperationOrComponentOpMethod(name, comp_method, no_mval) {
  Tensor[name] = new Function('TH', 'Tensor', [
    'return function(adata, bdata, not_in_place, mval) {',
    'mval = mval || 1;',
    'var end_ref = adata.data;',

    // if not in place, we have to add
    'if (not_in_place) {',
      'end_ref = Tensor.create_empty_of_size(adata.data.ref());',
    '}',

    'if (typeof(bdata) == "number")',
      'TH.THFloatTensor_' + name + '(end_ref.ref(), adata.data.ref(), mval * bdata)',
    'else',
      'TH.THFloatTensor_' + comp_method + '(end_ref.ref(), adata.data.ref(), ' + (no_mval ? '' : 'mval, ') + 'bdata.data.ref());',
    'return end_ref; }'
  ].join('\n'))(TH, Tensor);
}

function addBinaryMethod(name, mulval, isbyte) {
  mulval = mulval || 1

  var fn_inplace = new Function('Tensor', [
      'return function(c_or_tensor){',
      'this.assert_size_equal(c_or_tensor, "C' + name + ' must be equal sizes")',
      'Tensor.' + name + '(this, c_or_tensor, false, ' + mulval + ')',
      'return this; }'
  ].join('\n'))(Tensor);

 var fn_notinplace = new Function('Tensor', [
      'return function(c_or_tensor){',
      'this.assert_size_equal(c_or_tensor, "C' + name + ' must be equal sizes")',
      'var atensor = Tensor.' + name + '(this, c_or_tensor, true, ' + mulval + ')',
      'var cc = this.refClone()',
      ' cc.override(atensor, this.dims.slice(0))',//, "'+ isbyte +'")',
      'return cc; }'
  ].join('\n'))(Tensor);

  Tensor.prototype[name + 'eq'] = fn_inplace;
  Tensor.prototype[name] = fn_notinplace
}
// function addBinaryMethod(name, fncode) {
//     var fneqS = new Function('s', [
//         'var n = this.data.length;',
//         'var b = s;',
//         'while (n--) {',
//         ' --  var a = this.data[n];',
//         '   this.data[n] = ' + name + ';',
//         '}',
//         'return this;'
//     ].join('\n'));
//     var fneqT = new Function('t', [
//         'var n = this.data.length;',
//         'while (n--) {',
//         '   var a = this.data[n];',
//         '   var b = t.data[n];',
//         '   this.data[n] = ' + fncode + ';',
//         '}',
//         'return this;'
//     ].join('\n'));

//     var fneq = function(x) {
//         if (x.constructor === Tensor)
//             return fneqT.call(this, x);
//         else
//             return fneqS.call(this, x);
//     }
//     Tensor.prototype[name + 'eq'] = fneq;
//     Tensor.prototype[name] = function(x) {
//         var nt = this.clone();
//         return fneq.call(nt, x);
//     };
// }

// function addReduction(name, initcode, fncode) {
//     Tensor.prototype[name+'reduce'] = new Function([
//         'var accum = ' + initcode + ';',
//         'var n = this.data.length;',
//         'while (n--) {',
//         '   var x = this.data[n];',
//         '   accum = ' + fncode + ';',
//         '}',
//         'return accum;'
//     ].join('\n'));
// }

// Adding sub because method name not overloaded in addbinarymethod
var arith = ['add', 'sub', 'mul', 'div', 'pow'];

function createPrototype(name, isUnary, comp_meth, no_mval, isbyte) {
    if (isUnary) {
        addUnaryMethod(name);
        addUnaryPrototype(name);
    } else {
        if (arith.indexOf(name) > -1) {
          addOperationOrComponentOpMethod(name, comp_meth, no_mval);
        }
        addBinaryMethod(name, no_mval, isbyte);
    }
}

// Unary prototypes
createPrototype('neg', true);
createPrototype('round', true);
createPrototype('log', true);
createPrototype('exp', true);
createPrototype('sqrt', true);
createPrototype('abs', true);
createPrototype('ceil', true);
createPrototype('floor', true);
createPrototype('cos', true);
createPrototype('sin', true);
createPrototype('tan', true);
createPrototype('acos', true);
createPrototype('asin', true);
createPrototype('atan', true);
createPrototype('cosh', true);
createPrototype('sinh', true);
createPrototype('tanh', true);

// Warning: These do not exist in THm impl
createPrototype('acosh', true);
createPrototype('asinh',  true);
createPrototype('atanh', true);

// Binary Prototypes
createPrototype('add', false, 'cadd');
//addBinaryMethod('sub', false, -1);
createPrototype('sub', false, 'csub');
createPrototype('mul', false, "cmul", true);
createPrototype('div', false, "cdiv", true);
createPrototype('fmod', false);
createPrototype('pow', false, "cpow", true);
createPrototype('atan2', false);

//TODO: torch method name
createPrototype('eq', false, null, null, "Byte");
createPrototype('ne', false, null, null, "Byte");
createPrototype('gt', false, null, null, "Byte");
createPrototype('ge', false, null, null, "Byte");
createPrototype('lt', false, null, null, "Byte");
createPrototype('le', false, null, null, "Byte");

Tensor.eq = Tensor.byte_comparison("eqTensor")
Tensor.ne = Tensor.byte_comparison("neTensor")
Tensor.gt = Tensor.byte_comparison("gtTensor")
Tensor.ge = Tensor.byte_comparison("geTensor")
Tensor.lt = Tensor.byte_comparison("ltTensor")
Tensor.le = Tensor.byte_comparison("leTensor")

/*
 * The below functions are not supported by Torch
 */

// acosh
Tensor.prototype.acosheq = function() {
  //return Math.log(x + Math.sqrt(x * x - 1));
  var xx = this.clone().muleq(this).addeq(-1);
  return this.addeq(xx).logeq();
}

Tensor.prototype.acosh = function() {
  var cc = this.clone();
  cc.acosheq();
  return cc;
}

// asinh
Tensor.prototype.asinheq = function() {
  //return Math.log(x + Math.sqrt(x * x + 1));
  var xx = this.clone().muleq(this).addeq(1);
  return this.addeq(xx).logeq();
}

Tensor.prototype.asinh = function() {
  var cc = this.clone();
  cc.asinheq();
  return cc;
}

// atanh
Tensor.prototype.atanheq = function() {
  //Math.log((1+x)/(1-x)) / 2;
  var negxone = this.neg().addeq(1)
  return this.addeq(1).diveq(negxone).logeq().diveq(2)
}

Tensor.prototype.atanh = function() {
  var cc = this.clone();
  cc.atanheq();
  return cc;
}

Tensor.prototype.inverteq = function() {
  // '1 / x' 
  var cc = Tensor.create_empty_of_size(this.data.ref());
  THFloatTensor.fill(cc.ref(), 1);
  var ccTensor = this.refClone();
  ccTensor.override(cc, this.dims);
  ccTensor.diveq(this);
  this.copy(ccTensor);
  return this;
}

Tensor.prototype.invert = function() {
  var cc = this.clone();
  cc.inverteq();
  return cc;
}

Tensor.prototype.sigmoideq = function() {
  // 1 / (1 + Math.exp(-x)))
  return this.negeq().expeq().addeq(1).inverteq()
}

Tensor.prototype.sigmoid = function() {
  var cc = this.clone();
  cc.sigmoideq();
  return cc;
}

Tensor.prototype.isFiniteeq = function() {
  return this.applyFn(function(val) {
    return isFinite(val) ? 1.0 : 0.0;
  })
}

Tensor.prototype.isFinite = function() {
  var cc = this.clone();
  cc.isFiniteeq();
  return cc;
}

Tensor.prototype.isNaNeq = function() {
  return this.applyFn(function(val) {
    return isNaN(val) ? 1.0 : 0.0;
  });
}

Tensor.prototype.isNaN = function() {
  var cc = this.clone();
  cc.isNaNeq();
  return cc;
}

Tensor.prototype.pseudoinverteq = function() {
  return this.applyFn(function(val) {
    return val == 0 ? 0 : 1/val;
  });
}

Tensor.prototype.pseudoinvert = function() {
  var cc = this.clone();
  cc.pseudoinverteq();
  return cc;
}

// In-place softmax
Tensor.prototype.softmaxeq = function() {
  var max = this.max()
  // Don't clone
  var cc = this.addeq(-max).expeq()
  var sum = cc.sum()
  cc.diveq(sum)
  return this
};

Tensor.prototype.softmax = function() {
  // Find max elem
  var max = this.max()
  // clone it, subtract the max, then exponentiate
  var cc = this.clone().addeq(-max).expeq()
  var sum = cc.sum()
  // normalize
  cc.diveq(sum)
  return cc
};

Tensor.prototype.transpose = function(ix, ix2) {
  var ccTensor = this.clone()
  if(ix == undefined)
    TH.THFloatTensor_transpose(ccTensor.data.ref(), ref.NULL, 0, 1)
  else
    TH.THFloatTensor_transpose(ccTensor.data.ref(), ref.NULL, ix, ix2)
  return ccTensor
}
Tensor.prototype.T = Tensor.prototype.transpose

Tensor.prototype.diagonal = function() {
  assert.ok(this.rank === 2);
  //assert.ok(this.dims[1] === 1);
  
  var etensor = Tensor.create_empty_of_size(this.data.ref())
  TH.THFloatTensor_diag(etensor.ref(),this.data.ref(),0)
  var ccTensor = this.refClone()
  ccTensor.override(etensor, this.dims)
  return ccTensor
};

// Matrix inverse.
Tensor.prototype.inverse = function() {

  assert.ok(this.rank === 2);
  assert.ok(this.dims[0] === this.dims[1]);

  var etensor = Tensor.create_empty_of_size(this.data.ref())
  TH.THFloatTensor_getri(etensor.ref(), this.data.ref())

  var ccTensor = this.refClone()
  ccTensor.override(etensor, this.dims)
  return ccTensor
};

// Torch does not support determinants, so we compute product of real eigenvalues
Tensor.prototype.determinant = function() {
  assert.ok(this.rank === 2);
  assert.ok(this.dims[0] === this.dims[1]);

  var etensor = Tensor.create_empty_of_size(this.data.ref())
  TH.THFloatTensor_geev(etensor.ref(), ref.NULL, this.ref, 'N');

  var evals = new Tensor([this.dims[0]]);
  TH.THFloatTensor_narrow(evals.ref, etensor.ref(), 0, 0, this.dims[0]);
  //x = evals.clone();
  //var ev = new Tensor([evals.dims[0]]);
  //ev.slowCopy(evals);
  var ev = evals.clone();
  var det = TH.THFloatTensor_prodall(ev.ref);
  return det;
};

Tensor.prototype.dot = function(t) {
  var a = this, b = t;
  if (a.rank !== 2 || b.rank !== 2)
    throw new Error('Inputs to dot should have rank = 2.');
  if (a.dims[1] !== b.dims[0])
    throw new Error('Dimension mismatch in dot. Inputs have dimension ' + a.dims + ' and ' + b.dims + '.');
  var t_for_mul = TH.THFloatTensor_new().deref();
  TH.THFloatTensor_resize2d(t_for_mul.ref(), a.dims[0], b.dims[1]);
  var beta = 0, alpha = 1;
  TH.THFloatTensor_addmm(t_for_mul.ref(), beta, t_for_mul.ref(), alpha, a.data.ref(), b.data.ref());
  var mm_tensor = a.refClone();
  mm_tensor.override(t_for_mul, [a.dims[0], b.dims[1]]);
  return mm_tensor;
};

Tensor.prototype.cholesky = function() {
  assert.ok((this.rank === 2) && (this.dims[0] === this.dims[1]),
            'cholesky is only defined for square matrices.');

  var cc = Tensor.create_empty_of_size(this.data.ref())
  TH.THFloatTensor_potrf(this.data.ref(), cc.ref())
  var ccTensor = this.refClone()
  ccTensor.override(cc, this.dims.slice(0))
  return ccTensor
};


module.exports = Tensor;


