import { BufferAttribute, Vector3, Ray, Vector2, Vector4, Mesh, Matrix4, Line3, Plane, Triangle, DoubleSide, Matrix3, BufferGeometry, Group, Color, MeshPhongMaterial, MathUtils, LineSegments, LineBasicMaterial, InstancedMesh, SphereGeometry, MeshBasicMaterial } from 'three';
import { MeshBVH, ExtendedTriangle } from 'three-mesh-bvh';

const HASH_WIDTH = 1e-6;
const HASH_HALF_WIDTH = HASH_WIDTH * 0.5;
const HASH_MULTIPLIER = Math.pow( 10, - Math.log10( HASH_WIDTH ) );
const HASH_ADDITION = HASH_HALF_WIDTH * HASH_MULTIPLIER;
function hashNumber( v ) {

	return ~ ~ ( v * HASH_MULTIPLIER + HASH_ADDITION );

}

function hashVertex2( v ) {

	return `${ hashNumber( v.x ) },${ hashNumber( v.y ) }`;

}

function hashVertex3( v ) {

	return `${ hashNumber( v.x ) },${ hashNumber( v.y ) },${ hashNumber( v.z ) }`;

}

function hashVertex4( v ) {

	return `${ hashNumber( v.x ) },${ hashNumber( v.y ) },${ hashNumber( v.z ) },${ hashNumber( v.w ) }`;

}

function hashRay( r ) {

	return `${ hashVertex3( r.origin ) }-${ hashVertex3( r.direction ) }`;

}

function toNormalizedRay( v0, v1, target ) {

	// get a normalized direction
	target
		.direction
		.subVectors( v1, v0 )
		.normalize();

	// project the origin onto the perpendicular plane that
	// passes through 0, 0, 0
	const scalar = v0.dot( target.direction );
	target.
		origin
		.copy( v0 )
		.addScaledVector( target.direction, - scalar );

	return target;

}

function areSharedArrayBuffersSupported() {

	return typeof SharedArrayBuffer !== 'undefined';

}

function convertToSharedArrayBuffer( array ) {

	if ( array.buffer instanceof SharedArrayBuffer ) {

		return array;

	}

	const cons = array.constructor;
	const buffer = array.buffer;
	const sharedBuffer = new SharedArrayBuffer( buffer.byteLength );

	const uintArray = new Uint8Array( buffer );
	const sharedUintArray = new Uint8Array( sharedBuffer );
	sharedUintArray.set( uintArray, 0 );

	return new cons( sharedBuffer );

}

function getIndexArray( vertexCount, BufferConstructor = ArrayBuffer ) {

	if ( vertexCount > 65535 ) {

		return new Uint32Array( new BufferConstructor( 4 * vertexCount ) );

	} else {

		return new Uint16Array( new BufferConstructor( 2 * vertexCount ) );

	}

}

function ensureIndex( geo, options ) {

	if ( ! geo.index ) {

		const vertexCount = geo.attributes.position.count;
		const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
		const index = getIndexArray( vertexCount, BufferConstructor );
		geo.setIndex( new BufferAttribute( index, 1 ) );

		for ( let i = 0; i < vertexCount; i ++ ) {

			index[ i ] = i;

		}

	}

}

function getVertexCount( geo ) {

	return geo.index ? geo.index.count : geo.attributes.position.count;

}

function getTriCount( geo ) {

	return getVertexCount( geo ) / 3;

}

const DEGENERATE_EPSILON = 1e-8;
const _tempVec = new Vector3();

function toTriIndex( v ) {

	return ~ ~ ( v / 3 );

}

function toEdgeIndex( v ) {

	return v % 3;

}

function sortEdgeFunc( a, b ) {

	return a.start - b.start;

}

function getProjectedDistance( ray, vec ) {

	return _tempVec.subVectors( vec, ray.origin ).dot( ray.direction );

}

function hasOverlaps( arr ) {

	arr = [ ...arr ].sort( sortEdgeFunc );
	for ( let i = 0, l = arr.length; i < l - 1; i ++ ) {

		const info0 = arr[ i ];
		const info1 = arr[ i + 1 ];

		if ( info1.start < info0.end && Math.abs( info1.start - info0.end ) > 1e-5 ) {

			return true;

		}

	}

	return false;

}

function getEdgeSetLength( arr ) {

	let tot = 0;
	arr.forEach( ( { start, end } ) => tot += end - start );
	return tot;

}

function matchEdges( forward, reverse, disjointConnectivityMap, eps = DEGENERATE_EPSILON ) {

	forward.sort( sortEdgeFunc );
	reverse.sort( sortEdgeFunc );

	for ( let i = 0; i < forward.length; i ++ ) {

		const e0 = forward[ i ];
		for ( let o = 0; o < reverse.length; o ++ ) {

			const e1 = reverse[ o ];
			if ( e1.start > e0.end ) {

				// e2 is completely after e1
				// break;

				// NOTE: there are cases where there are overlaps due to precision issues or
				// thin / degenerate triangles. Assuming the sibling side has the same issues
				// we let the matching work here. Long term we should remove the degenerate
				// triangles before this.

			} else if ( e0.end < e1.start || e1.end < e0.start ) {

				// e1 is completely before e2
				continue;

			} else if ( e0.start <= e1.start && e0.end >= e1.end ) {

				// e1 is larger than and e2 is completely within e1
				if ( ! areDistancesDegenerate( e1.end, e0.end ) ) {

					forward.splice( i + 1, 0, {
						start: e1.end,
						end: e0.end,
						index: e0.index,
					} );

				}

				e0.end = e1.start;

				e1.start = 0;
				e1.end = 0;

			} else if ( e0.start >= e1.start && e0.end <= e1.end ) {

				// e2 is larger than and e1 is completely within e2
				if ( ! areDistancesDegenerate( e0.end, e1.end ) ) {

					reverse.splice( o + 1, 0, {
						start: e0.end,
						end: e1.end,
						index: e1.index,
					} );

				}

				e1.end = e0.start;

				e0.start = 0;
				e0.end = 0;

			} else if ( e0.start <= e1.start && e0.end <= e1.end ) {

				// e1 overlaps e2 at the beginning
				const tmp = e0.end;
				e0.end = e1.start;
				e1.start = tmp;

			} else if ( e0.start >= e1.start && e0.end >= e1.end ) {

				// e1 overlaps e2 at the end
				const tmp = e1.end;
				e1.end = e0.start;
				e0.start = tmp;

			} else {

				throw new Error();

			}

			// Add the connectivity information
			if ( ! disjointConnectivityMap.has( e0.index ) ) {

				disjointConnectivityMap.set( e0.index, [] );

			}

			if ( ! disjointConnectivityMap.has( e1.index ) ) {

				disjointConnectivityMap.set( e1.index, [] );

			}

			disjointConnectivityMap
				.get( e0.index )
				.push( e1.index );

			disjointConnectivityMap
				.get( e1.index )
				.push( e0.index );

			if ( isEdgeDegenerate( e1 ) ) {

				reverse.splice( o, 1 );
				o --;

			}

			if ( isEdgeDegenerate( e0 ) ) {

				// and if we have to remove the current original edge then exit this loop
				// so we can work on the next one
				forward.splice( i, 1 );
				i --;
				break;

			}

		}

	}

	cleanUpEdgeSet( forward );
	cleanUpEdgeSet( reverse );

	function cleanUpEdgeSet( arr ) {

		for ( let i = 0; i < arr.length; i ++ ) {

			if ( isEdgeDegenerate( arr[ i ] ) ) {

				arr.splice( i, 1 );
				i --;

			}

		}

	}

	function areDistancesDegenerate( start, end ) {

		return Math.abs( end - start ) < eps;

	}

	function isEdgeDegenerate( e ) {

		return Math.abs( e.end - e.start ) < eps;

	}

}

const DIST_EPSILON = 1e-5;
const ANGLE_EPSILON = 1e-4;

class RaySet {

	constructor() {

		this._rays = [];

	}

	addRay( ray ) {

		this._rays.push( ray );

	}

	findClosestRay( ray ) {

		const rays = this._rays;
		const inv = ray.clone();
		inv.direction.multiplyScalar( - 1 );

		let bestScore = Infinity;
		let bestRay = null;
		for ( let i = 0, l = rays.length; i < l; i ++ ) {

			const r = rays[ i ];
			if ( skipRay( r, ray ) && skipRay( r, inv ) ) {

				continue;

			}

			const rayScore = scoreRays( r, ray );
			const invScore = scoreRays( r, inv );
			const score = Math.min( rayScore, invScore );
			if ( score < bestScore ) {

				bestScore = score;
				bestRay = r;

			}

		}

		return bestRay;

		function skipRay( r0, r1 ) {

			const distOutOfThreshold = r0.origin.distanceTo( r1.origin ) > DIST_EPSILON;
			const angleOutOfThreshold = r0.direction.angleTo( r1.direction ) > ANGLE_EPSILON;
			return angleOutOfThreshold || distOutOfThreshold;

		}

		function scoreRays( r0, r1 ) {

			const originDistance = r0.origin.distanceTo( r1.origin );
			const angleDistance = r0.direction.angleTo( r1.direction );
			return originDistance / DIST_EPSILON + angleDistance / ANGLE_EPSILON;

		}

	}

}

const _v0 = new Vector3();
const _v1 = new Vector3();
const _ray$2 = new Ray();

function computeDisjointEdges(
	geometry,
	unmatchedSet,
	eps,
) {

	const attributes = geometry.attributes;
	const indexAttr = geometry.index;
	const posAttr = attributes.position;

	const disjointConnectivityMap = new Map();
	const fragmentMap = new Map();
	const edges = Array.from( unmatchedSet );
	const rays = new RaySet();

	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		// get the triangle edge
		const index = edges[ i ];
		const triIndex = toTriIndex( index );
		const edgeIndex = toEdgeIndex( index );

		let i0 = 3 * triIndex + edgeIndex;
		let i1 = 3 * triIndex + ( edgeIndex + 1 ) % 3;
		if ( indexAttr ) {

			i0 = indexAttr.getX( i0 );
			i1 = indexAttr.getX( i1 );

		}

		_v0.fromBufferAttribute( posAttr, i0 );
		_v1.fromBufferAttribute( posAttr, i1 );

		// get the ray corresponding to the edge
		toNormalizedRay( _v0, _v1, _ray$2 );

		// find the shared ray with other edges
		let info;
		let commonRay = rays.findClosestRay( _ray$2 );
		if ( commonRay === null ) {

			commonRay = _ray$2.clone();
			rays.addRay( commonRay );

		}

		if ( ! fragmentMap.has( commonRay ) ) {

			fragmentMap.set( commonRay, {

				forward: [],
				reverse: [],
				ray: commonRay,

			} );

		}

		info = fragmentMap.get( commonRay );

		// store the stride of edge endpoints along the ray
		let start = getProjectedDistance( commonRay, _v0 );
		let end = getProjectedDistance( commonRay, _v1 );
		if ( start > end ) {

			[ start, end ] = [ end, start ];

		}

		if ( _ray$2.direction.dot( commonRay.direction ) < 0 ) {

			info.reverse.push( { start, end, index } );

		} else {

			info.forward.push( { start, end, index } );

		}

	}

	// match the found sibling edges
	fragmentMap.forEach( ( { forward, reverse }, ray ) => {

		matchEdges( forward, reverse, disjointConnectivityMap, eps );

		if ( forward.length === 0 && reverse.length === 0 ) {

			fragmentMap.delete( ray );

		}

	} );

	return {
		disjointConnectivityMap,
		fragmentMap,
	};

}

const _vec2$2 = new Vector2();
const _vec3$1 = new Vector3();
const _vec4$1 = new Vector4();
const _hashes = [ '', '', '' ];

class HalfEdgeMap {

	constructor() {

		// result data
		this.data = null;
		this.disjointConnections = null;
		this.unmatchedDisjointEdges = null;
		this.unmatchedEdges = - 1;
		this.matchedEdges = - 1;

		// options
		this.useDrawRange = true;
		this.useAllAttributes = false;
		this.matchDisjointEdges = false;
		this.degenerateEpsilon = 1e-8;

	}

	getSiblingTriangleIndex( triIndex, edgeIndex ) {

		const otherIndex = this.data[ triIndex * 3 + edgeIndex ];
		return otherIndex === - 1 ? - 1 : ~ ~ ( otherIndex / 3 );

	}

	getSiblingEdgeIndex( triIndex, edgeIndex ) {

		const otherIndex = this.data[ triIndex * 3 + edgeIndex ];
		return otherIndex === - 1 ? - 1 : ( otherIndex % 3 );

	}

	getDisjointSiblingTriangleIndices( triIndex, edgeIndex ) {

		const index = triIndex * 3 + edgeIndex;
		const arr = this.disjointConnections.get( index );
		return arr ? arr.map( i => ~ ~ ( i / 3 ) ) : [];

	}

	getDisjointSiblingEdgeIndices( triIndex, edgeIndex ) {

		const index = triIndex * 3 + edgeIndex;
		const arr = this.disjointConnections.get( index );
		return arr ? arr.map( i => i % 3 ) : [];

	}

	isFullyConnected() {

		return this.unmatchedEdges === 0;

	}

	updateFrom( geometry ) {

		const { useAllAttributes, useDrawRange, matchDisjointEdges, degenerateEpsilon } = this;
		const hashFunction = useAllAttributes ? hashAllAttributes : hashPositionAttribute;

		// runs on the assumption that there is a 1 : 1 match of edges
		const map = new Map();

		// attributes
		const { attributes } = geometry;
		const attrKeys = useAllAttributes ? Object.keys( attributes ) : null;
		const indexAttr = geometry.index;
		const posAttr = attributes.position;

		// get the potential number of triangles
		let triCount = getTriCount( geometry );
		const maxTriCount = triCount;

		// get the real number of triangles from the based on the draw range
		let offset = 0;
		if ( useDrawRange ) {

			offset = geometry.drawRange.start;
			if ( geometry.drawRange.count !== Infinity ) {

				triCount = ~ ~ ( geometry.drawRange.count / 3 );

			}

		}

		// initialize the connectivity buffer - 1 means no connectivity
		let data = this.data;
		if ( ! data || data.length < 3 * maxTriCount ) {

			data = new Int32Array( 3 * maxTriCount );

		}

		data.fill( - 1 );

		// iterate over all triangles
		let matchedEdges = 0;
		let unmatchedSet = new Set();
		for ( let i = offset, l = triCount * 3 + offset; i < l; i += 3 ) {

			const i3 = i;
			for ( let e = 0; e < 3; e ++ ) {

				let i0 = i3 + e;
				if ( indexAttr ) {

					i0 = indexAttr.getX( i0 );

				}

				_hashes[ e ] = hashFunction( i0 );

			}

			for ( let e = 0; e < 3; e ++ ) {

				const nextE = ( e + 1 ) % 3;
				const vh0 = _hashes[ e ];
				const vh1 = _hashes[ nextE ];

				const reverseHash = `${ vh1 }_${ vh0 }`;
				if ( map.has( reverseHash ) ) {

					// create a reference between the two triangles and clear the hash
					const index = i3 + e;
					const otherIndex = map.get( reverseHash );
					data[ index ] = otherIndex;
					data[ otherIndex ] = index;
					map.delete( reverseHash );
					matchedEdges += 2;
					unmatchedSet.delete( otherIndex );

				} else {

					// save the triangle and triangle edge index captured in one value
					// triIndex = ~ ~ ( i0 / 3 );
					// edgeIndex = i0 % 3;
					const hash = `${ vh0 }_${ vh1 }`;
					const index = i3 + e;
					map.set( hash, index );
					unmatchedSet.add( index );

				}

			}

		}

		if ( matchDisjointEdges ) {

			const {
				fragmentMap,
				disjointConnectivityMap,
			} = computeDisjointEdges( geometry, unmatchedSet, degenerateEpsilon );

			unmatchedSet.clear();
			fragmentMap.forEach( ( { forward, reverse } ) => {

				forward.forEach( ( { index } ) => unmatchedSet.add( index ) );
				reverse.forEach( ( { index } ) => unmatchedSet.add( index ) );

			} );

			this.unmatchedDisjointEdges = fragmentMap;
			this.disjointConnections = disjointConnectivityMap;
			matchedEdges = triCount * 3 - unmatchedSet.size;

		}

		this.matchedEdges = matchedEdges;
		this.unmatchedEdges = unmatchedSet.size;
		this.data = data;

		function hashPositionAttribute( i ) {

			_vec3$1.fromBufferAttribute( posAttr, i );
			return hashVertex3( _vec3$1 );

		}

		function hashAllAttributes( i ) {

			let result = '';
			for ( let k = 0, l = attrKeys.length; k < l; k ++ ) {

				const attr = attributes[ attrKeys[ k ] ];
				let str;
				switch ( attr.itemSize ) {

					case 1:
						str = hashNumber( attr.getX( i ) );
						break;
					case 2:
						str = hashVertex2( _vec2$2.fromBufferAttribute( attr, i ) );
						break;
					case 3:
						str = hashVertex3( _vec3$1.fromBufferAttribute( attr, i ) );
						break;
					case 4:
						str = hashVertex4( _vec4$1.fromBufferAttribute( attr, i ) );
						break;

				}

				if ( result !== '' ) {

					result += '|';

				}

				result += str;

			}

			return result;

		}

	}

}

class Brush extends Mesh {

	constructor( ...args ) {

		super( ...args );

		this.isBrush = true;
		this._previousMatrix = new Matrix4();
		this._previousMatrix.elements.fill( 0 );
		this._halfEdges = null;
		this._boundsTree = null;
		this._groupIndices = null;
		this._hash = null;

	}

	markUpdated() {

		this._previousMatrix.copy( this.matrix );

	}

	isDirty() {

		const { matrix, _previousMatrix } = this;
		const el1 = matrix.elements;
		const el2 = _previousMatrix.elements;
		for ( let i = 0; i < 16; i ++ ) {

			if ( el1[ i ] !== el2[ i ] ) {

				return true;

			}

		}

		return false;

	}

	prepareGeometry() {

		// generate shared array buffers
		const geometry = this.geometry;
		const attributes = geometry.attributes;
		const useSharedArrayBuffer = areSharedArrayBuffersSupported();

		const index = geometry.index;
		const posAttr = geometry.attributes.position;
		const indexHash = index ? `${ index.uuid }_${ index.count }_${ index.version }` : '-1_-1_-1';
		const posHash = `${ posAttr.uuid }_${ posAttr.count }_${ posAttr.version }`;
		const hash = `${ geometry.uuid }_${ indexHash }_${ posHash }`;
		if ( this._hash === hash ) {

			return;

		}

		this._hash = hash;
		if ( useSharedArrayBuffer ) {

			for ( const key in attributes ) {

				const attribute = attributes[ key ];
				if ( attribute.isInterleavedBufferAttribute ) {

					throw new Error( 'Brush: InterleavedBufferAttributes are not supported.' );

				}

				attribute.array = convertToSharedArrayBuffer( attribute.array );

			}

		}

		// generate bounds tree
		geometry.boundsTree = new MeshBVH( geometry, { maxLeafSize: 3, indirect: true, useSharedArrayBuffer } );

		// generate half edges
		if ( ! geometry.halfEdges ) {

			geometry.halfEdges = new HalfEdgeMap();

		}

		geometry.halfEdges.updateFrom( geometry );

		// save group indices for materials
		const triCount = getTriCount( geometry );
		if ( ! geometry.groupIndices || geometry.groupIndices.length !== triCount ) {

			geometry.groupIndices = new Uint16Array( triCount );

		}

		const array = geometry.groupIndices;
		const groups = geometry.groups;
		for ( let i = 0, l = groups.length; i < l; i ++ ) {

			const { start, count } = groups[ i ];
			for ( let g = start / 3, lg = ( start + count ) / 3; g < lg; g ++ ) {

				array[ g ] = i;

			}

		}

	}

	disposeCacheData() {

		const { geometry } = this;
		geometry.halfEdges = null;
		geometry.boundsTree = null;
		geometry.groupIndices = null;

	}

}

// Auto-generated ESM bundle of cdt2d
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// node_modules/binary-search-bounds/search-bounds.js
var require_search_bounds = __commonJS({
  "node_modules/binary-search-bounds/search-bounds.js"(exports, module) {
    "use strict";
    function ge(a, y, c, l, h) {
      var i = h + 1;
      while (l <= h) {
        var m = l + h >>> 1, x = a[m];
        var p = c !== void 0 ? c(x, y) : x - y;
        if (p >= 0) {
          i = m;
          h = m - 1;
        } else {
          l = m + 1;
        }
      }
      return i;
    }
    function gt(a, y, c, l, h) {
      var i = h + 1;
      while (l <= h) {
        var m = l + h >>> 1, x = a[m];
        var p = c !== void 0 ? c(x, y) : x - y;
        if (p > 0) {
          i = m;
          h = m - 1;
        } else {
          l = m + 1;
        }
      }
      return i;
    }
    function lt(a, y, c, l, h) {
      var i = l - 1;
      while (l <= h) {
        var m = l + h >>> 1, x = a[m];
        var p = c !== void 0 ? c(x, y) : x - y;
        if (p < 0) {
          i = m;
          l = m + 1;
        } else {
          h = m - 1;
        }
      }
      return i;
    }
    function le(a, y, c, l, h) {
      var i = l - 1;
      while (l <= h) {
        var m = l + h >>> 1, x = a[m];
        var p = c !== void 0 ? c(x, y) : x - y;
        if (p <= 0) {
          i = m;
          l = m + 1;
        } else {
          h = m - 1;
        }
      }
      return i;
    }
    function eq(a, y, c, l, h) {
      while (l <= h) {
        var m = l + h >>> 1, x = a[m];
        var p = c !== void 0 ? c(x, y) : x - y;
        if (p === 0) {
          return m;
        }
        if (p <= 0) {
          l = m + 1;
        } else {
          h = m - 1;
        }
      }
      return -1;
    }
    function norm(a, y, c, l, h, f) {
      if (typeof c === "function") {
        return f(a, y, c, l === void 0 ? 0 : l | 0, h === void 0 ? a.length - 1 : h | 0);
      }
      return f(a, y, void 0, c === void 0 ? 0 : c | 0, l === void 0 ? a.length - 1 : l | 0);
    }
    module.exports = {
      ge: function(a, y, c, l, h) {
        return norm(a, y, c, l, h, ge);
      },
      gt: function(a, y, c, l, h) {
        return norm(a, y, c, l, h, gt);
      },
      lt: function(a, y, c, l, h) {
        return norm(a, y, c, l, h, lt);
      },
      le: function(a, y, c, l, h) {
        return norm(a, y, c, l, h, le);
      },
      eq: function(a, y, c, l, h) {
        return norm(a, y, c, l, h, eq);
      }
    };
  }
});

// node_modules/two-product/two-product.js
var require_two_product = __commonJS({
  "node_modules/two-product/two-product.js"(exports, module) {
    "use strict";
    module.exports = twoProduct;
    var SPLITTER = +(Math.pow(2, 27) + 1);
    function twoProduct(a, b, result) {
      var x = a * b;
      var c = SPLITTER * a;
      var abig = c - a;
      var ahi = c - abig;
      var alo = a - ahi;
      var d = SPLITTER * b;
      var bbig = d - b;
      var bhi = d - bbig;
      var blo = b - bhi;
      var err1 = x - ahi * bhi;
      var err2 = err1 - alo * bhi;
      var err3 = err2 - ahi * blo;
      var y = alo * blo - err3;
      if (result) {
        result[0] = y;
        result[1] = x;
        return result;
      }
      return [y, x];
    }
  }
});

// node_modules/robust-sum/robust-sum.js
var require_robust_sum = __commonJS({
  "node_modules/robust-sum/robust-sum.js"(exports, module) {
    "use strict";
    module.exports = linearExpansionSum;
    function scalarScalar(a, b) {
      var x = a + b;
      var bv = x - a;
      var av = x - bv;
      var br = b - bv;
      var ar = a - av;
      var y = ar + br;
      if (y) {
        return [y, x];
      }
      return [x];
    }
    function linearExpansionSum(e, f) {
      var ne = e.length | 0;
      var nf = f.length | 0;
      if (ne === 1 && nf === 1) {
        return scalarScalar(e[0], f[0]);
      }
      var n = ne + nf;
      var g = new Array(n);
      var count = 0;
      var eptr = 0;
      var fptr = 0;
      var abs = Math.abs;
      var ei = e[eptr];
      var ea = abs(ei);
      var fi = f[fptr];
      var fa = abs(fi);
      var a, b;
      if (ea < fa) {
        b = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        b = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = f[fptr];
          fa = abs(fi);
        }
      }
      if (eptr < ne && ea < fa || fptr >= nf) {
        a = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        a = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = f[fptr];
          fa = abs(fi);
        }
      }
      var x = a + b;
      var bv = x - a;
      var y = b - bv;
      var q0 = y;
      var q1 = x;
      var _x, _bv, _av, _br, _ar;
      while (eptr < ne && fptr < nf) {
        if (ea < fa) {
          a = ei;
          eptr += 1;
          if (eptr < ne) {
            ei = e[eptr];
            ea = abs(ei);
          }
        } else {
          a = fi;
          fptr += 1;
          if (fptr < nf) {
            fi = f[fptr];
            fa = abs(fi);
          }
        }
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
      }
      while (eptr < ne) {
        a = ei;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
        }
      }
      while (fptr < nf) {
        a = fi;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        fptr += 1;
        if (fptr < nf) {
          fi = f[fptr];
        }
      }
      if (q0) {
        g[count++] = q0;
      }
      if (q1) {
        g[count++] = q1;
      }
      if (!count) {
        g[count++] = 0;
      }
      g.length = count;
      return g;
    }
  }
});

// node_modules/two-sum/two-sum.js
var require_two_sum = __commonJS({
  "node_modules/two-sum/two-sum.js"(exports, module) {
    "use strict";
    module.exports = fastTwoSum;
    function fastTwoSum(a, b, result) {
      var x = a + b;
      var bv = x - a;
      var av = x - bv;
      var br = b - bv;
      var ar = a - av;
      if (result) {
        result[0] = ar + br;
        result[1] = x;
        return result;
      }
      return [ar + br, x];
    }
  }
});

// node_modules/robust-scale/robust-scale.js
var require_robust_scale = __commonJS({
  "node_modules/robust-scale/robust-scale.js"(exports, module) {
    "use strict";
    var twoProduct = require_two_product();
    var twoSum = require_two_sum();
    module.exports = scaleLinearExpansion;
    function scaleLinearExpansion(e, scale) {
      var n = e.length;
      if (n === 1) {
        var ts = twoProduct(e[0], scale);
        if (ts[0]) {
          return ts;
        }
        return [ts[1]];
      }
      var g = new Array(2 * n);
      var q = [0.1, 0.1];
      var t = [0.1, 0.1];
      var count = 0;
      twoProduct(e[0], scale, q);
      if (q[0]) {
        g[count++] = q[0];
      }
      for (var i = 1; i < n; ++i) {
        twoProduct(e[i], scale, t);
        var pq = q[1];
        twoSum(pq, t[0], q);
        if (q[0]) {
          g[count++] = q[0];
        }
        var a = t[1];
        var b = q[1];
        var x = a + b;
        var bv = x - a;
        var y = b - bv;
        q[1] = x;
        if (y) {
          g[count++] = y;
        }
      }
      if (q[1]) {
        g[count++] = q[1];
      }
      if (count === 0) {
        g[count++] = 0;
      }
      g.length = count;
      return g;
    }
  }
});

// node_modules/robust-subtract/robust-diff.js
var require_robust_diff = __commonJS({
  "node_modules/robust-subtract/robust-diff.js"(exports, module) {
    "use strict";
    module.exports = robustSubtract;
    function scalarScalar(a, b) {
      var x = a + b;
      var bv = x - a;
      var av = x - bv;
      var br = b - bv;
      var ar = a - av;
      var y = ar + br;
      if (y) {
        return [y, x];
      }
      return [x];
    }
    function robustSubtract(e, f) {
      var ne = e.length | 0;
      var nf = f.length | 0;
      if (ne === 1 && nf === 1) {
        return scalarScalar(e[0], -f[0]);
      }
      var n = ne + nf;
      var g = new Array(n);
      var count = 0;
      var eptr = 0;
      var fptr = 0;
      var abs = Math.abs;
      var ei = e[eptr];
      var ea = abs(ei);
      var fi = -f[fptr];
      var fa = abs(fi);
      var a, b;
      if (ea < fa) {
        b = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        b = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = -f[fptr];
          fa = abs(fi);
        }
      }
      if (eptr < ne && ea < fa || fptr >= nf) {
        a = ei;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
          ea = abs(ei);
        }
      } else {
        a = fi;
        fptr += 1;
        if (fptr < nf) {
          fi = -f[fptr];
          fa = abs(fi);
        }
      }
      var x = a + b;
      var bv = x - a;
      var y = b - bv;
      var q0 = y;
      var q1 = x;
      var _x, _bv, _av, _br, _ar;
      while (eptr < ne && fptr < nf) {
        if (ea < fa) {
          a = ei;
          eptr += 1;
          if (eptr < ne) {
            ei = e[eptr];
            ea = abs(ei);
          }
        } else {
          a = fi;
          fptr += 1;
          if (fptr < nf) {
            fi = -f[fptr];
            fa = abs(fi);
          }
        }
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
      }
      while (eptr < ne) {
        a = ei;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        eptr += 1;
        if (eptr < ne) {
          ei = e[eptr];
        }
      }
      while (fptr < nf) {
        a = fi;
        b = q0;
        x = a + b;
        bv = x - a;
        y = b - bv;
        if (y) {
          g[count++] = y;
        }
        _x = q1 + x;
        _bv = _x - q1;
        _av = _x - _bv;
        _br = x - _bv;
        _ar = q1 - _av;
        q0 = _ar + _br;
        q1 = _x;
        fptr += 1;
        if (fptr < nf) {
          fi = -f[fptr];
        }
      }
      if (q0) {
        g[count++] = q0;
      }
      if (q1) {
        g[count++] = q1;
      }
      if (!count) {
        g[count++] = 0;
      }
      g.length = count;
      return g;
    }
  }
});

// node_modules/robust-orientation/orientation.js
var require_orientation = __commonJS({
  "node_modules/robust-orientation/orientation.js"(exports, module) {
    "use strict";
    var twoProduct = require_two_product();
    var robustSum = require_robust_sum();
    var robustScale = require_robust_scale();
    var robustSubtract = require_robust_diff();
    var NUM_EXPAND = 5;
    var EPSILON = 11102230246251565e-32;
    var ERRBOUND3 = (3 + 16 * EPSILON) * EPSILON;
    var ERRBOUND4 = (7 + 56 * EPSILON) * EPSILON;
    function orientation_3(sum, prod, scale, sub) {
      return function orientation3Exact2(m0, m1, m2) {
        var p = sum(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])));
        var n = sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0]));
        var d = sub(p, n);
        return d[d.length - 1];
      };
    }
    function orientation_4(sum, prod, scale, sub) {
      return function orientation4Exact2(m0, m1, m2, m3) {
        var p = sum(sum(scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m1[2]), sum(scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), -m2[2]), scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m3[2]))), sum(scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m3[2]))));
        var n = sum(sum(scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m0[2]), sum(scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m2[2]), scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m3[2]))), sum(scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m2[2]))));
        var d = sub(p, n);
        return d[d.length - 1];
      };
    }
    function orientation_5(sum, prod, scale, sub) {
      return function orientation5Exact(m0, m1, m2, m3, m4) {
        var p = sum(sum(sum(scale(sum(scale(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m2[2]), sum(scale(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), -m3[2]), scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m4[2]))), m1[3]), sum(scale(sum(scale(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m1[2]), sum(scale(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m3[2]), scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m4[2]))), -m2[3]), scale(sum(scale(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m1[2]), sum(scale(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m2[2]), scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m4[2]))), m3[3]))), sum(scale(sum(scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m1[2]), sum(scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), -m2[2]), scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m3[2]))), -m4[3]), sum(scale(sum(scale(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m1[2]), sum(scale(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m3[2]), scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m4[2]))), m0[3]), scale(sum(scale(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m0[2]), sum(scale(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m3[2]), scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), m4[2]))), -m1[3])))), sum(sum(scale(sum(scale(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m4[2]))), m3[3]), sum(scale(sum(scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m3[2]))), -m4[3]), scale(sum(scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m1[2]), sum(scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), -m2[2]), scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m3[2]))), m0[3]))), sum(scale(sum(scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m0[2]), sum(scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m2[2]), scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m3[2]))), -m1[3]), sum(scale(sum(scale(sum(prod(m1[1], m3[0]), prod(-m3[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m3[2]))), m2[3]), scale(sum(scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m2[2]))), -m3[3])))));
        var n = sum(sum(sum(scale(sum(scale(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m2[2]), sum(scale(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), -m3[2]), scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m4[2]))), m0[3]), scale(sum(scale(sum(prod(m3[1], m4[0]), prod(-m4[1], m3[0])), m0[2]), sum(scale(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m3[2]), scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), m4[2]))), -m2[3])), sum(scale(sum(scale(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m0[2]), sum(scale(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m2[2]), scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m4[2]))), m3[3]), scale(sum(scale(sum(prod(m2[1], m3[0]), prod(-m3[1], m2[0])), m0[2]), sum(scale(sum(prod(m0[1], m3[0]), prod(-m3[1], m0[0])), -m2[2]), scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m3[2]))), -m4[3]))), sum(sum(scale(sum(scale(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m1[2]), sum(scale(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), -m2[2]), scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m4[2]))), m0[3]), scale(sum(scale(sum(prod(m2[1], m4[0]), prod(-m4[1], m2[0])), m0[2]), sum(scale(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m2[2]), scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), m4[2]))), -m1[3])), sum(scale(sum(scale(sum(prod(m1[1], m4[0]), prod(-m4[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m4[0]), prod(-m4[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m4[2]))), m2[3]), scale(sum(scale(sum(prod(m1[1], m2[0]), prod(-m2[1], m1[0])), m0[2]), sum(scale(sum(prod(m0[1], m2[0]), prod(-m2[1], m0[0])), -m1[2]), scale(sum(prod(m0[1], m1[0]), prod(-m1[1], m0[0])), m2[2]))), -m4[3]))));
        var d = sub(p, n);
        return d[d.length - 1];
      };
    }
    function orientation(n) {
      var fn = n === 3 ? orientation_3 : n === 4 ? orientation_4 : orientation_5;
      return fn(robustSum, twoProduct, robustScale, robustSubtract);
    }
    var orientation3Exact = orientation(3);
    var orientation4Exact = orientation(4);
    var CACHED = [
      function orientation0() {
        return 0;
      },
      function orientation1() {
        return 0;
      },
      function orientation2(a, b) {
        return b[0] - a[0];
      },
      function orientation3(a, b, c) {
        var l = (a[1] - c[1]) * (b[0] - c[0]);
        var r = (a[0] - c[0]) * (b[1] - c[1]);
        var det = l - r;
        var s;
        if (l > 0) {
          if (r <= 0) {
            return det;
          } else {
            s = l + r;
          }
        } else if (l < 0) {
          if (r >= 0) {
            return det;
          } else {
            s = -(l + r);
          }
        } else {
          return det;
        }
        var tol = ERRBOUND3 * s;
        if (det >= tol || det <= -tol) {
          return det;
        }
        return orientation3Exact(a, b, c);
      },
      function orientation4(a, b, c, d) {
        var adx = a[0] - d[0];
        var bdx = b[0] - d[0];
        var cdx = c[0] - d[0];
        var ady = a[1] - d[1];
        var bdy = b[1] - d[1];
        var cdy = c[1] - d[1];
        var adz = a[2] - d[2];
        var bdz = b[2] - d[2];
        var cdz = c[2] - d[2];
        var bdxcdy = bdx * cdy;
        var cdxbdy = cdx * bdy;
        var cdxady = cdx * ady;
        var adxcdy = adx * cdy;
        var adxbdy = adx * bdy;
        var bdxady = bdx * ady;
        var det = adz * (bdxcdy - cdxbdy) + bdz * (cdxady - adxcdy) + cdz * (adxbdy - bdxady);
        var permanent = (Math.abs(bdxcdy) + Math.abs(cdxbdy)) * Math.abs(adz) + (Math.abs(cdxady) + Math.abs(adxcdy)) * Math.abs(bdz) + (Math.abs(adxbdy) + Math.abs(bdxady)) * Math.abs(cdz);
        var tol = ERRBOUND4 * permanent;
        if (det > tol || -det > tol) {
          return det;
        }
        return orientation4Exact(a, b, c, d);
      }
    ];
    function slowOrient(args) {
      var proc2 = CACHED[args.length];
      if (!proc2) {
        proc2 = CACHED[args.length] = orientation(args.length);
      }
      return proc2.apply(void 0, args);
    }
    function proc(slow, o0, o1, o2, o3, o4, o5) {
      return function getOrientation(a0, a1, a2, a3, a4) {
        switch (arguments.length) {
          case 0:
          case 1:
            return 0;
          case 2:
            return o2(a0, a1);
          case 3:
            return o3(a0, a1, a2);
          case 4:
            return o4(a0, a1, a2, a3);
          case 5:
            return o5(a0, a1, a2, a3, a4);
        }
        var s = new Array(arguments.length);
        for (var i = 0; i < arguments.length; ++i) {
          s[i] = arguments[i];
        }
        return slow(s);
      };
    }
    function generateOrientationProc() {
      while (CACHED.length <= NUM_EXPAND) {
        CACHED.push(orientation(CACHED.length));
      }
      module.exports = proc.apply(void 0, [slowOrient].concat(CACHED));
      for (var i = 0; i <= NUM_EXPAND; ++i) {
        module.exports[i] = CACHED[i];
      }
    }
    generateOrientationProc();
  }
});

// node_modules/cdt2d/lib/monotone.js
var require_monotone = __commonJS({
  "node_modules/cdt2d/lib/monotone.js"(exports, module) {
    "use strict";
    var bsearch = require_search_bounds();
    var orient = require_orientation()[3];
    var EVENT_POINT = 0;
    var EVENT_END = 1;
    var EVENT_START = 2;
    module.exports = monotoneTriangulate;
    function PartialHull(a, b, idx, lowerIds, upperIds) {
      this.a = a;
      this.b = b;
      this.idx = idx;
      this.lowerIds = lowerIds;
      this.upperIds = upperIds;
    }
    function Event(a, b, type, idx) {
      this.a = a;
      this.b = b;
      this.type = type;
      this.idx = idx;
    }
    function compareEvent(a, b) {
      var d = a.a[0] - b.a[0] || a.a[1] - b.a[1] || a.type - b.type;
      if (d) {
        return d;
      }
      if (a.type !== EVENT_POINT) {
        d = orient(a.a, a.b, b.b);
        if (d) {
          return d;
        }
      }
      return a.idx - b.idx;
    }
    function testPoint(hull, p) {
      return orient(hull.a, hull.b, p);
    }
    function addPoint(cells, hulls, points, p, idx) {
      var lo = bsearch.lt(hulls, p, testPoint);
      var hi = bsearch.gt(hulls, p, testPoint);
      for (var i = lo; i < hi; ++i) {
        var hull = hulls[i];
        var lowerIds = hull.lowerIds;
        var m = lowerIds.length;
        while (m > 1 && orient(
          points[lowerIds[m - 2]],
          points[lowerIds[m - 1]],
          p
        ) > 0) {
          cells.push(
            [
              lowerIds[m - 1],
              lowerIds[m - 2],
              idx
            ]
          );
          m -= 1;
        }
        lowerIds.length = m;
        lowerIds.push(idx);
        var upperIds = hull.upperIds;
        var m = upperIds.length;
        while (m > 1 && orient(
          points[upperIds[m - 2]],
          points[upperIds[m - 1]],
          p
        ) < 0) {
          cells.push(
            [
              upperIds[m - 2],
              upperIds[m - 1],
              idx
            ]
          );
          m -= 1;
        }
        upperIds.length = m;
        upperIds.push(idx);
      }
    }
    function findSplit(hull, edge) {
      var d;
      if (hull.a[0] < edge.a[0]) {
        d = orient(hull.a, hull.b, edge.a);
      } else {
        d = orient(edge.b, edge.a, hull.a);
      }
      if (d) {
        return d;
      }
      if (edge.b[0] < hull.b[0]) {
        d = orient(hull.a, hull.b, edge.b);
      } else {
        d = orient(edge.b, edge.a, hull.b);
      }
      return d || hull.idx - edge.idx;
    }
    function splitHulls(hulls, points, event) {
      var splitIdx = bsearch.le(hulls, event, findSplit);
      var hull = hulls[splitIdx];
      var upperIds = hull.upperIds;
      var x = upperIds[upperIds.length - 1];
      hull.upperIds = [x];
      hulls.splice(
        splitIdx + 1,
        0,
        new PartialHull(event.a, event.b, event.idx, [x], upperIds)
      );
    }
    function mergeHulls(hulls, points, event) {
      var tmp = event.a;
      event.a = event.b;
      event.b = tmp;
      var mergeIdx = bsearch.eq(hulls, event, findSplit);
      var upper = hulls[mergeIdx];
      var lower = hulls[mergeIdx - 1];
      lower.upperIds = upper.upperIds;
      hulls.splice(mergeIdx, 1);
    }
    function monotoneTriangulate(points, edges) {
      var numPoints = points.length;
      var numEdges = edges.length;
      var events = [];
      for (var i = 0; i < numPoints; ++i) {
        events.push(new Event(
          points[i],
          null,
          EVENT_POINT,
          i
        ));
      }
      for (var i = 0; i < numEdges; ++i) {
        var e = edges[i];
        var a = points[e[0]];
        var b = points[e[1]];
        if (a[0] < b[0]) {
          events.push(
            new Event(a, b, EVENT_START, i),
            new Event(b, a, EVENT_END, i)
          );
        } else if (a[0] > b[0]) {
          events.push(
            new Event(b, a, EVENT_START, i),
            new Event(a, b, EVENT_END, i)
          );
        }
      }
      events.sort(compareEvent);
      var minX = events[0].a[0] - (1 + Math.abs(events[0].a[0])) * Math.pow(2, -52);
      var hull = [new PartialHull([minX, 1], [minX, 0], -1, [], [], [], [])];
      var cells = [];
      for (var i = 0, numEvents = events.length; i < numEvents; ++i) {
        var event = events[i];
        var type = event.type;
        if (type === EVENT_POINT) {
          addPoint(cells, hull, points, event.a, event.idx);
        } else if (type === EVENT_START) {
          splitHulls(hull, points, event);
        } else {
          mergeHulls(hull, points, event);
        }
      }
      return cells;
    }
  }
});

// node_modules/cdt2d/lib/triangulation.js
var require_triangulation = __commonJS({
  "node_modules/cdt2d/lib/triangulation.js"(exports, module) {
    "use strict";
    var bsearch = require_search_bounds();
    module.exports = createTriangulation;
    function Triangulation(stars, edges) {
      this.stars = stars;
      this.edges = edges;
    }
    var proto = Triangulation.prototype;
    function removePair(list, j, k) {
      for (var i = 1, n = list.length; i < n; i += 2) {
        if (list[i - 1] === j && list[i] === k) {
          list[i - 1] = list[n - 2];
          list[i] = list[n - 1];
          list.length = n - 2;
          return;
        }
      }
    }
    proto.isConstraint = /* @__PURE__ */ (function() {
      var e = [0, 0];
      function compareLex(a, b) {
        return a[0] - b[0] || a[1] - b[1];
      }
      return function(i, j) {
        e[0] = Math.min(i, j);
        e[1] = Math.max(i, j);
        return bsearch.eq(this.edges, e, compareLex) >= 0;
      };
    })();
    proto.removeTriangle = function(i, j, k) {
      var stars = this.stars;
      removePair(stars[i], j, k);
      removePair(stars[j], k, i);
      removePair(stars[k], i, j);
    };
    proto.addTriangle = function(i, j, k) {
      var stars = this.stars;
      stars[i].push(j, k);
      stars[j].push(k, i);
      stars[k].push(i, j);
    };
    proto.opposite = function(j, i) {
      var list = this.stars[i];
      for (var k = 1, n = list.length; k < n; k += 2) {
        if (list[k] === j) {
          return list[k - 1];
        }
      }
      return -1;
    };
    proto.flip = function(i, j) {
      var a = this.opposite(i, j);
      var b = this.opposite(j, i);
      this.removeTriangle(i, j, a);
      this.removeTriangle(j, i, b);
      this.addTriangle(i, b, a);
      this.addTriangle(j, a, b);
    };
    proto.edges = function() {
      var stars = this.stars;
      var result = [];
      for (var i = 0, n = stars.length; i < n; ++i) {
        var list = stars[i];
        for (var j = 0, m = list.length; j < m; j += 2) {
          result.push([list[j], list[j + 1]]);
        }
      }
      return result;
    };
    proto.cells = function() {
      var stars = this.stars;
      var result = [];
      for (var i = 0, n = stars.length; i < n; ++i) {
        var list = stars[i];
        for (var j = 0, m = list.length; j < m; j += 2) {
          var s = list[j];
          var t = list[j + 1];
          if (i < Math.min(s, t)) {
            result.push([i, s, t]);
          }
        }
      }
      return result;
    };
    function createTriangulation(numVerts, edges) {
      var stars = new Array(numVerts);
      for (var i = 0; i < numVerts; ++i) {
        stars[i] = [];
      }
      return new Triangulation(stars, edges);
    }
  }
});

// node_modules/robust-in-sphere/in-sphere.js
var require_in_sphere = __commonJS({
  "node_modules/robust-in-sphere/in-sphere.js"(exports, module) {
    "use strict";
    var twoProduct = require_two_product();
    var robustSum = require_robust_sum();
    var robustDiff = require_robust_diff();
    var robustScale = require_robust_scale();
    var NUM_EXPAND = 6;
    function orientation(n) {
      var fn = n === 3 ? inSphere3 : n === 4 ? inSphere4 : n === 5 ? inSphere5 : inSphere6;
      return fn(robustSum, robustDiff, twoProduct, robustScale);
    }
    function inSphere0() {
      return 0;
    }
    function inSphere1() {
      return 0;
    }
    function inSphere2() {
      return 0;
    }
    function inSphere3(sum, diff, prod, scale) {
      function exactInSphere3(m0, m1, m2) {
        var w0 = prod(m0[0], m0[0]);
        var w0m1 = scale(w0, m1[0]);
        var w0m2 = scale(w0, m2[0]);
        var w1 = prod(m1[0], m1[0]);
        var w1m0 = scale(w1, m0[0]);
        var w1m2 = scale(w1, m2[0]);
        var w2 = prod(m2[0], m2[0]);
        var w2m0 = scale(w2, m0[0]);
        var w2m1 = scale(w2, m1[0]);
        var p = sum(diff(w2m1, w1m2), diff(w1m0, w0m1));
        var n = diff(w2m0, w0m2);
        var d = diff(p, n);
        return d[d.length - 1];
      }
      return exactInSphere3;
    }
    function inSphere4(sum, diff, prod, scale) {
      function exactInSphere4(m0, m1, m2, m3) {
        var w0 = sum(prod(m0[0], m0[0]), prod(m0[1], m0[1]));
        var w0m1 = scale(w0, m1[0]);
        var w0m2 = scale(w0, m2[0]);
        var w0m3 = scale(w0, m3[0]);
        var w1 = sum(prod(m1[0], m1[0]), prod(m1[1], m1[1]));
        var w1m0 = scale(w1, m0[0]);
        var w1m2 = scale(w1, m2[0]);
        var w1m3 = scale(w1, m3[0]);
        var w2 = sum(prod(m2[0], m2[0]), prod(m2[1], m2[1]));
        var w2m0 = scale(w2, m0[0]);
        var w2m1 = scale(w2, m1[0]);
        var w2m3 = scale(w2, m3[0]);
        var w3 = sum(prod(m3[0], m3[0]), prod(m3[1], m3[1]));
        var w3m0 = scale(w3, m0[0]);
        var w3m1 = scale(w3, m1[0]);
        var w3m2 = scale(w3, m2[0]);
        var p = sum(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))));
        var n = sum(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))));
        var d = diff(p, n);
        return d[d.length - 1];
      }
      return exactInSphere4;
    }
    function inSphere5(sum, diff, prod, scale) {
      function exactInSphere5(m0, m1, m2, m3, m4) {
        var w0 = sum(prod(m0[0], m0[0]), sum(prod(m0[1], m0[1]), prod(m0[2], m0[2])));
        var w0m1 = scale(w0, m1[0]);
        var w0m2 = scale(w0, m2[0]);
        var w0m3 = scale(w0, m3[0]);
        var w0m4 = scale(w0, m4[0]);
        var w1 = sum(prod(m1[0], m1[0]), sum(prod(m1[1], m1[1]), prod(m1[2], m1[2])));
        var w1m0 = scale(w1, m0[0]);
        var w1m2 = scale(w1, m2[0]);
        var w1m3 = scale(w1, m3[0]);
        var w1m4 = scale(w1, m4[0]);
        var w2 = sum(prod(m2[0], m2[0]), sum(prod(m2[1], m2[1]), prod(m2[2], m2[2])));
        var w2m0 = scale(w2, m0[0]);
        var w2m1 = scale(w2, m1[0]);
        var w2m3 = scale(w2, m3[0]);
        var w2m4 = scale(w2, m4[0]);
        var w3 = sum(prod(m3[0], m3[0]), sum(prod(m3[1], m3[1]), prod(m3[2], m3[2])));
        var w3m0 = scale(w3, m0[0]);
        var w3m1 = scale(w3, m1[0]);
        var w3m2 = scale(w3, m2[0]);
        var w3m4 = scale(w3, m4[0]);
        var w4 = sum(prod(m4[0], m4[0]), sum(prod(m4[1], m4[1]), prod(m4[2], m4[2])));
        var w4m0 = scale(w4, m0[0]);
        var w4m1 = scale(w4, m1[0]);
        var w4m2 = scale(w4, m2[0]);
        var w4m3 = scale(w4, m3[0]);
        var p = sum(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), m1[2]), sum(scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), -m2[2]), scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), m3[2]))), sum(scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), -m4[2]), sum(scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), m0[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m1[2])))), sum(sum(scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), m3[2]), sum(scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), -m4[2]), scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), m0[2]))), sum(scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m1[2]), sum(scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m3[2])))));
        var n = sum(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), m0[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m2[2])), sum(scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m4[2]))), sum(sum(scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), m0[2]), scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), -m1[2])), sum(scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m4[2]))));
        var d = diff(p, n);
        return d[d.length - 1];
      }
      return exactInSphere5;
    }
    function inSphere6(sum, diff, prod, scale) {
      function exactInSphere6(m0, m1, m2, m3, m4, m5) {
        var w0 = sum(sum(prod(m0[0], m0[0]), prod(m0[1], m0[1])), sum(prod(m0[2], m0[2]), prod(m0[3], m0[3])));
        var w0m1 = scale(w0, m1[0]);
        var w0m2 = scale(w0, m2[0]);
        var w0m3 = scale(w0, m3[0]);
        var w0m4 = scale(w0, m4[0]);
        var w0m5 = scale(w0, m5[0]);
        var w1 = sum(sum(prod(m1[0], m1[0]), prod(m1[1], m1[1])), sum(prod(m1[2], m1[2]), prod(m1[3], m1[3])));
        var w1m0 = scale(w1, m0[0]);
        var w1m2 = scale(w1, m2[0]);
        var w1m3 = scale(w1, m3[0]);
        var w1m4 = scale(w1, m4[0]);
        var w1m5 = scale(w1, m5[0]);
        var w2 = sum(sum(prod(m2[0], m2[0]), prod(m2[1], m2[1])), sum(prod(m2[2], m2[2]), prod(m2[3], m2[3])));
        var w2m0 = scale(w2, m0[0]);
        var w2m1 = scale(w2, m1[0]);
        var w2m3 = scale(w2, m3[0]);
        var w2m4 = scale(w2, m4[0]);
        var w2m5 = scale(w2, m5[0]);
        var w3 = sum(sum(prod(m3[0], m3[0]), prod(m3[1], m3[1])), sum(prod(m3[2], m3[2]), prod(m3[3], m3[3])));
        var w3m0 = scale(w3, m0[0]);
        var w3m1 = scale(w3, m1[0]);
        var w3m2 = scale(w3, m2[0]);
        var w3m4 = scale(w3, m4[0]);
        var w3m5 = scale(w3, m5[0]);
        var w4 = sum(sum(prod(m4[0], m4[0]), prod(m4[1], m4[1])), sum(prod(m4[2], m4[2]), prod(m4[3], m4[3])));
        var w4m0 = scale(w4, m0[0]);
        var w4m1 = scale(w4, m1[0]);
        var w4m2 = scale(w4, m2[0]);
        var w4m3 = scale(w4, m3[0]);
        var w4m5 = scale(w4, m5[0]);
        var w5 = sum(sum(prod(m5[0], m5[0]), prod(m5[1], m5[1])), sum(prod(m5[2], m5[2]), prod(m5[3], m5[3])));
        var w5m0 = scale(w5, m0[0]);
        var w5m1 = scale(w5, m1[0]);
        var w5m2 = scale(w5, m2[0]);
        var w5m3 = scale(w5, m3[0]);
        var w5m4 = scale(w5, m4[0]);
        var p = sum(sum(sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m3[1]), sum(scale(diff(w5m3, w3m5), -m4[1]), scale(diff(w4m3, w3m4), m5[1]))), m2[2]), scale(sum(scale(diff(w5m4, w4m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m4[1]), scale(diff(w4m2, w2m4), m5[1]))), -m3[2])), sum(scale(sum(scale(diff(w5m3, w3m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m3[1]), scale(diff(w3m2, w2m3), m5[1]))), m4[2]), scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), -m5[2]))), m1[3]), sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m3[1]), sum(scale(diff(w5m3, w3m5), -m4[1]), scale(diff(w4m3, w3m4), m5[1]))), m1[2]), scale(sum(scale(diff(w5m4, w4m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m4[1]), scale(diff(w4m1, w1m4), m5[1]))), -m3[2])), sum(scale(sum(scale(diff(w5m3, w3m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m3[1]), scale(diff(w3m1, w1m3), m5[1]))), m4[2]), scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), -m5[2]))), -m2[3]), scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m4[1]), scale(diff(w4m2, w2m4), m5[1]))), m1[2]), scale(sum(scale(diff(w5m4, w4m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m4[1]), scale(diff(w4m1, w1m4), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m2[1]), scale(diff(w2m1, w1m2), m5[1]))), m4[2]), scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), -m5[2]))), m3[3]))), sum(sum(scale(sum(sum(scale(sum(scale(diff(w5m3, w3m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m3[1]), scale(diff(w3m2, w2m3), m5[1]))), m1[2]), scale(sum(scale(diff(w5m3, w3m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m3[1]), scale(diff(w3m1, w1m3), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m2[1]), scale(diff(w2m1, w1m2), m5[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), -m5[2]))), -m4[3]), scale(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), m1[2]), scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), -m2[2])), sum(scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), -m4[2]))), m5[3])), sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m3[1]), sum(scale(diff(w5m3, w3m5), -m4[1]), scale(diff(w4m3, w3m4), m5[1]))), m1[2]), scale(sum(scale(diff(w5m4, w4m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m4[1]), scale(diff(w4m1, w1m4), m5[1]))), -m3[2])), sum(scale(sum(scale(diff(w5m3, w3m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m3[1]), scale(diff(w3m1, w1m3), m5[1]))), m4[2]), scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), -m5[2]))), m0[3]), scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m3[1]), sum(scale(diff(w5m3, w3m5), -m4[1]), scale(diff(w4m3, w3m4), m5[1]))), m0[2]), scale(sum(scale(diff(w5m4, w4m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m4[1]), scale(diff(w4m0, w0m4), m5[1]))), -m3[2])), sum(scale(sum(scale(diff(w5m3, w3m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m3[1]), scale(diff(w3m0, w0m3), m5[1]))), m4[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m5[2]))), -m1[3])))), sum(sum(sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m4[1]), scale(diff(w4m1, w1m4), m5[1]))), m0[2]), scale(sum(scale(diff(w5m4, w4m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m4[1]), scale(diff(w4m0, w0m4), m5[1]))), -m1[2])), sum(scale(sum(scale(diff(w5m1, w1m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m1[1]), scale(diff(w1m0, w0m1), m5[1]))), m4[2]), scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), -m5[2]))), m3[3]), scale(sum(sum(scale(sum(scale(diff(w5m3, w3m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m3[1]), scale(diff(w3m1, w1m3), m5[1]))), m0[2]), scale(sum(scale(diff(w5m3, w3m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m3[1]), scale(diff(w3m0, w0m3), m5[1]))), -m1[2])), sum(scale(sum(scale(diff(w5m1, w1m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m1[1]), scale(diff(w1m0, w0m1), m5[1]))), m3[2]), scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), -m5[2]))), -m4[3])), sum(scale(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), m0[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m1[2])), sum(scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), m3[2]), scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), -m4[2]))), m5[3]), scale(sum(sum(scale(sum(scale(diff(w5m3, w3m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m3[1]), scale(diff(w3m2, w2m3), m5[1]))), m1[2]), scale(sum(scale(diff(w5m3, w3m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m3[1]), scale(diff(w3m1, w1m3), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m2[1]), scale(diff(w2m1, w1m2), m5[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), -m5[2]))), m0[3]))), sum(sum(scale(sum(sum(scale(sum(scale(diff(w5m3, w3m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m3[1]), scale(diff(w3m2, w2m3), m5[1]))), m0[2]), scale(sum(scale(diff(w5m3, w3m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m3[1]), scale(diff(w3m0, w0m3), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m2[1]), scale(diff(w2m0, w0m2), m5[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m5[2]))), -m1[3]), scale(sum(sum(scale(sum(scale(diff(w5m3, w3m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m3[1]), scale(diff(w3m1, w1m3), m5[1]))), m0[2]), scale(sum(scale(diff(w5m3, w3m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m3[1]), scale(diff(w3m0, w0m3), m5[1]))), -m1[2])), sum(scale(sum(scale(diff(w5m1, w1m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m1[1]), scale(diff(w1m0, w0m1), m5[1]))), m3[2]), scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), -m5[2]))), m2[3])), sum(scale(sum(sum(scale(sum(scale(diff(w5m2, w2m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m2[1]), scale(diff(w2m1, w1m2), m5[1]))), m0[2]), scale(sum(scale(diff(w5m2, w2m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m2[1]), scale(diff(w2m0, w0m2), m5[1]))), -m1[2])), sum(scale(sum(scale(diff(w5m1, w1m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m1[1]), scale(diff(w1m0, w0m1), m5[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m5[2]))), -m3[3]), scale(sum(sum(scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), m0[2]), scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m1[2])), sum(scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m3[2]))), m5[3])))));
        var n = sum(sum(sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m3[1]), sum(scale(diff(w5m3, w3m5), -m4[1]), scale(diff(w4m3, w3m4), m5[1]))), m2[2]), scale(sum(scale(diff(w5m4, w4m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m4[1]), scale(diff(w4m2, w2m4), m5[1]))), -m3[2])), sum(scale(sum(scale(diff(w5m3, w3m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m3[1]), scale(diff(w3m2, w2m3), m5[1]))), m4[2]), scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), -m5[2]))), m0[3]), sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m3[1]), sum(scale(diff(w5m3, w3m5), -m4[1]), scale(diff(w4m3, w3m4), m5[1]))), m0[2]), scale(sum(scale(diff(w5m4, w4m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m4[1]), scale(diff(w4m0, w0m4), m5[1]))), -m3[2])), sum(scale(sum(scale(diff(w5m3, w3m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m3[1]), scale(diff(w3m0, w0m3), m5[1]))), m4[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m5[2]))), -m2[3]), scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m4[1]), scale(diff(w4m2, w2m4), m5[1]))), m0[2]), scale(sum(scale(diff(w5m4, w4m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m4[1]), scale(diff(w4m0, w0m4), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m2[1]), scale(diff(w2m0, w0m2), m5[1]))), m4[2]), scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), -m5[2]))), m3[3]))), sum(sum(scale(sum(sum(scale(sum(scale(diff(w5m3, w3m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m3[1]), scale(diff(w3m2, w2m3), m5[1]))), m0[2]), scale(sum(scale(diff(w5m3, w3m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m3[1]), scale(diff(w3m0, w0m3), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m2[1]), scale(diff(w2m0, w0m2), m5[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m5[2]))), -m4[3]), scale(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), m0[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m2[2])), sum(scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m4[2]))), m5[3])), sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m4[1]), scale(diff(w4m2, w2m4), m5[1]))), m1[2]), scale(sum(scale(diff(w5m4, w4m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m4[1]), scale(diff(w4m1, w1m4), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m2[1]), scale(diff(w2m1, w1m2), m5[1]))), m4[2]), scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), -m5[2]))), m0[3]), scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m2[1]), sum(scale(diff(w5m2, w2m5), -m4[1]), scale(diff(w4m2, w2m4), m5[1]))), m0[2]), scale(sum(scale(diff(w5m4, w4m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m4[1]), scale(diff(w4m0, w0m4), m5[1]))), -m2[2])), sum(scale(sum(scale(diff(w5m2, w2m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m2[1]), scale(diff(w2m0, w0m2), m5[1]))), m4[2]), scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), -m5[2]))), -m1[3])))), sum(sum(sum(scale(sum(sum(scale(sum(scale(diff(w5m4, w4m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m4[1]), scale(diff(w4m1, w1m4), m5[1]))), m0[2]), scale(sum(scale(diff(w5m4, w4m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m4[1]), scale(diff(w4m0, w0m4), m5[1]))), -m1[2])), sum(scale(sum(scale(diff(w5m1, w1m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m1[1]), scale(diff(w1m0, w0m1), m5[1]))), m4[2]), scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), -m5[2]))), m2[3]), scale(sum(sum(scale(sum(scale(diff(w5m2, w2m5), m1[1]), sum(scale(diff(w5m1, w1m5), -m2[1]), scale(diff(w2m1, w1m2), m5[1]))), m0[2]), scale(sum(scale(diff(w5m2, w2m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m2[1]), scale(diff(w2m0, w0m2), m5[1]))), -m1[2])), sum(scale(sum(scale(diff(w5m1, w1m5), m0[1]), sum(scale(diff(w5m0, w0m5), -m1[1]), scale(diff(w1m0, w0m1), m5[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m5[2]))), -m4[3])), sum(scale(sum(sum(scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), m0[2]), scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), -m1[2])), sum(scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m4[2]))), m5[3]), scale(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), m1[2]), scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), -m2[2])), sum(scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), -m4[2]))), m0[3]))), sum(sum(scale(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m2[1]), sum(scale(diff(w4m2, w2m4), -m3[1]), scale(diff(w3m2, w2m3), m4[1]))), m0[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m2[2])), sum(scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), m3[2]), scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m4[2]))), -m1[3]), scale(sum(sum(scale(sum(scale(diff(w4m3, w3m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m3[1]), scale(diff(w3m1, w1m3), m4[1]))), m0[2]), scale(sum(scale(diff(w4m3, w3m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m3[1]), scale(diff(w3m0, w0m3), m4[1]))), -m1[2])), sum(scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), m3[2]), scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), -m4[2]))), m2[3])), sum(scale(sum(sum(scale(sum(scale(diff(w4m2, w2m4), m1[1]), sum(scale(diff(w4m1, w1m4), -m2[1]), scale(diff(w2m1, w1m2), m4[1]))), m0[2]), scale(sum(scale(diff(w4m2, w2m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m2[1]), scale(diff(w2m0, w0m2), m4[1]))), -m1[2])), sum(scale(sum(scale(diff(w4m1, w1m4), m0[1]), sum(scale(diff(w4m0, w0m4), -m1[1]), scale(diff(w1m0, w0m1), m4[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m4[2]))), -m3[3]), scale(sum(sum(scale(sum(scale(diff(w3m2, w2m3), m1[1]), sum(scale(diff(w3m1, w1m3), -m2[1]), scale(diff(w2m1, w1m2), m3[1]))), m0[2]), scale(sum(scale(diff(w3m2, w2m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m2[1]), scale(diff(w2m0, w0m2), m3[1]))), -m1[2])), sum(scale(sum(scale(diff(w3m1, w1m3), m0[1]), sum(scale(diff(w3m0, w0m3), -m1[1]), scale(diff(w1m0, w0m1), m3[1]))), m2[2]), scale(sum(scale(diff(w2m1, w1m2), m0[1]), sum(scale(diff(w2m0, w0m2), -m1[1]), scale(diff(w1m0, w0m1), m2[1]))), -m3[2]))), m4[3])))));
        var d = diff(p, n);
        return d[d.length - 1];
      }
      return exactInSphere6;
    }
    var CACHED = [
      inSphere0,
      inSphere1,
      inSphere2
    ];
    function slowInSphere(args) {
      var proc2 = CACHED[args.length];
      if (!proc2) {
        proc2 = CACHED[args.length] = orientation(args.length);
      }
      return proc2.apply(void 0, args);
    }
    function proc(slow, o0, o1, o2, o3, o4, o5, o6) {
      function testInSphere(a0, a1, a2, a3, a4, a5) {
        switch (arguments.length) {
          case 0:
          case 1:
            return 0;
          case 2:
            return o2(a0, a1);
          case 3:
            return o3(a0, a1, a2);
          case 4:
            return o4(a0, a1, a2, a3);
          case 5:
            return o5(a0, a1, a2, a3, a4);
          case 6:
            return o6(a0, a1, a2, a3, a4, a5);
        }
        var s = new Array(arguments.length);
        for (var i = 0; i < arguments.length; ++i) {
          s[i] = arguments[i];
        }
        return slow(s);
      }
      return testInSphere;
    }
    function generateInSphereTest() {
      while (CACHED.length <= NUM_EXPAND) {
        CACHED.push(orientation(CACHED.length));
      }
      module.exports = proc.apply(void 0, [slowInSphere].concat(CACHED));
      for (var i = 0; i <= NUM_EXPAND; ++i) {
        module.exports[i] = CACHED[i];
      }
    }
    generateInSphereTest();
  }
});

// node_modules/cdt2d/lib/delaunay.js
var require_delaunay = __commonJS({
  "node_modules/cdt2d/lib/delaunay.js"(exports, module) {
    "use strict";
    var inCircle = require_in_sphere()[4];
    var bsearch = require_search_bounds();
    module.exports = delaunayRefine;
    function testFlip(points, triangulation, stack, a, b, x) {
      var y = triangulation.opposite(a, b);
      if (y < 0) {
        return;
      }
      if (b < a) {
        var tmp = a;
        a = b;
        b = tmp;
        tmp = x;
        x = y;
        y = tmp;
      }
      if (triangulation.isConstraint(a, b)) {
        return;
      }
      if (inCircle(points[a], points[b], points[x], points[y]) < 0) {
        stack.push(a, b);
      }
    }
    function delaunayRefine(points, triangulation) {
      var stack = [];
      var numPoints = points.length;
      var stars = triangulation.stars;
      for (var a = 0; a < numPoints; ++a) {
        var star = stars[a];
        for (var j = 1; j < star.length; j += 2) {
          var b = star[j];
          if (b < a) {
            continue;
          }
          if (triangulation.isConstraint(a, b)) {
            continue;
          }
          var x = star[j - 1], y = -1;
          for (var k = 1; k < star.length; k += 2) {
            if (star[k - 1] === b) {
              y = star[k];
              break;
            }
          }
          if (y < 0) {
            continue;
          }
          if (inCircle(points[a], points[b], points[x], points[y]) < 0) {
            stack.push(a, b);
          }
        }
      }
      while (stack.length > 0) {
        var b = stack.pop();
        var a = stack.pop();
        var x = -1, y = -1;
        var star = stars[a];
        for (var i = 1; i < star.length; i += 2) {
          var s = star[i - 1];
          var t = star[i];
          if (s === b) {
            y = t;
          } else if (t === b) {
            x = s;
          }
        }
        if (x < 0 || y < 0) {
          continue;
        }
        if (inCircle(points[a], points[b], points[x], points[y]) >= 0) {
          continue;
        }
        triangulation.flip(a, b);
        testFlip(points, triangulation, stack, x, a, y);
        testFlip(points, triangulation, stack, a, y, x);
        testFlip(points, triangulation, stack, y, b, x);
        testFlip(points, triangulation, stack, b, x, y);
      }
    }
  }
});

// node_modules/cdt2d/lib/filter.js
var require_filter = __commonJS({
  "node_modules/cdt2d/lib/filter.js"(exports, module) {
    "use strict";
    var bsearch = require_search_bounds();
    module.exports = classifyFaces;
    function FaceIndex(cells, neighbor, constraint, flags, active, next, boundary) {
      this.cells = cells;
      this.neighbor = neighbor;
      this.flags = flags;
      this.constraint = constraint;
      this.active = active;
      this.next = next;
      this.boundary = boundary;
    }
    var proto = FaceIndex.prototype;
    function compareCell(a, b) {
      return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    }
    proto.locate = /* @__PURE__ */ (function() {
      var key = [0, 0, 0];
      return function(a, b, c) {
        var x = a, y = b, z = c;
        if (b < c) {
          if (b < a) {
            x = b;
            y = c;
            z = a;
          }
        } else if (c < a) {
          x = c;
          y = a;
          z = b;
        }
        if (x < 0) {
          return -1;
        }
        key[0] = x;
        key[1] = y;
        key[2] = z;
        return bsearch.eq(this.cells, key, compareCell);
      };
    })();
    function indexCells(triangulation, infinity) {
      var cells = triangulation.cells();
      var nc = cells.length;
      for (var i = 0; i < nc; ++i) {
        var c = cells[i];
        var x = c[0], y = c[1], z = c[2];
        if (y < z) {
          if (y < x) {
            c[0] = y;
            c[1] = z;
            c[2] = x;
          }
        } else if (z < x) {
          c[0] = z;
          c[1] = x;
          c[2] = y;
        }
      }
      cells.sort(compareCell);
      var flags = new Array(nc);
      for (var i = 0; i < flags.length; ++i) {
        flags[i] = 0;
      }
      var active = [];
      var next = [];
      var neighbor = new Array(3 * nc);
      var constraint = new Array(3 * nc);
      var boundary = null;
      if (infinity) {
        boundary = [];
      }
      var index = new FaceIndex(
        cells,
        neighbor,
        constraint,
        flags,
        active,
        next,
        boundary
      );
      for (var i = 0; i < nc; ++i) {
        var c = cells[i];
        for (var j = 0; j < 3; ++j) {
          var x = c[j], y = c[(j + 1) % 3];
          var a = neighbor[3 * i + j] = index.locate(y, x, triangulation.opposite(y, x));
          var b = constraint[3 * i + j] = triangulation.isConstraint(x, y);
          if (a < 0) {
            if (b) {
              next.push(i);
            } else {
              active.push(i);
              flags[i] = 1;
            }
            if (infinity) {
              boundary.push([y, x, -1]);
            }
          }
        }
      }
      return index;
    }
    function filterCells(cells, flags, target) {
      var ptr = 0;
      for (var i = 0; i < cells.length; ++i) {
        if (flags[i] === target) {
          cells[ptr++] = cells[i];
        }
      }
      cells.length = ptr;
      return cells;
    }
    function classifyFaces(triangulation, target, infinity) {
      var index = indexCells(triangulation, infinity);
      if (target === 0) {
        if (infinity) {
          return index.cells.concat(index.boundary);
        } else {
          return index.cells;
        }
      }
      var side = 1;
      var active = index.active;
      var next = index.next;
      var flags = index.flags;
      var cells = index.cells;
      var constraint = index.constraint;
      var neighbor = index.neighbor;
      while (active.length > 0 || next.length > 0) {
        while (active.length > 0) {
          var t = active.pop();
          if (flags[t] === -side) {
            continue;
          }
          flags[t] = side;
          var c = cells[t];
          for (var j = 0; j < 3; ++j) {
            var f = neighbor[3 * t + j];
            if (f >= 0 && flags[f] === 0) {
              if (constraint[3 * t + j]) {
                next.push(f);
              } else {
                active.push(f);
                flags[f] = side;
              }
            }
          }
        }
        var tmp = next;
        next = active;
        active = tmp;
        next.length = 0;
        side = -side;
      }
      var result = filterCells(cells, flags, target);
      if (infinity) {
        return result.concat(index.boundary);
      }
      return result;
    }
  }
});

// node_modules/cdt2d/cdt2d.js
var require_cdt2d = __commonJS({
  "node_modules/cdt2d/cdt2d.js"(exports, module) {
    var monotoneTriangulate = require_monotone();
    var makeIndex = require_triangulation();
    var delaunayFlip = require_delaunay();
    var filterTriangulation = require_filter();
    module.exports = cdt2d;
    function canonicalizeEdge(e) {
      return [Math.min(e[0], e[1]), Math.max(e[0], e[1])];
    }
    function compareEdge(a, b) {
      return a[0] - b[0] || a[1] - b[1];
    }
    function canonicalizeEdges(edges) {
      return edges.map(canonicalizeEdge).sort(compareEdge);
    }
    function getDefault(options, property, dflt) {
      if (property in options) {
        return options[property];
      }
      return dflt;
    }
    function cdt2d(points, edges, options) {
      if (!Array.isArray(edges)) {
        options = edges || {};
        edges = [];
      } else {
        options = options || {};
        edges = edges || [];
      }
      var delaunay = !!getDefault(options, "delaunay", true);
      var interior = !!getDefault(options, "interior", true);
      var exterior = !!getDefault(options, "exterior", true);
      var infinity = !!getDefault(options, "infinity", false);
      if (!interior && !exterior || points.length === 0) {
        return [];
      }
      var cells = monotoneTriangulate(points, edges);
      if (delaunay || interior !== exterior || infinity) {
        var triangulation = makeIndex(points.length, canonicalizeEdges(edges));
        for (var i = 0; i < cells.length; ++i) {
          var f = cells[i];
          triangulation.addTriangle(f[0], f[1], f[2]);
        }
        if (delaunay) {
          delaunayFlip(points, triangulation);
        }
        if (!exterior) {
          return filterTriangulation(triangulation, -1);
        } else if (!interior) {
          return filterTriangulation(triangulation, 1, infinity);
        } else if (infinity) {
          return filterTriangulation(triangulation, 0, infinity);
        } else {
          return triangulation.cells();
        }
      } else {
        return cells;
      }
    }
  }
});
var cdt2d = require_cdt2d();

// class for getting reusable object instances and releasing them for reuse
class Pool {

	constructor( createFn ) {

		this.createFn = createFn;
		this._pool = [];
		this._index = 0;

	}

	getInstance() {

		if ( this._index >= this._pool.length ) {

			this._pool.push( this.createFn() );

		}

		return this._pool[ this._index ++ ];

	}

	clear() {

		this._index = 0;

	}

	reset() {

		this._pool.length = 0;
		this._index = 0;

	}

}

// relative tolerance factor — multiplied by the max absolute coordinate
// of the base triangle to get scale-appropriate thresholds
const RELATIVE_EPSILON = 1e-16;

// tolerance for merging nearby vertices (squared distance)
const VERTEX_MERGE_EPSILON = 1e-16;

const _vec$2 = new Vector3();
const _vec2$1 = new Vector3();
const _paramPool = new Pool( () => ( { param: 0, index: 0 } ) );
const _vectorPool = new Pool( () => new Vector3() );

function edgesToIndices( edges, outputVertices, outputIndices, epsilonScale ) {

	_paramPool.clear();

	outputVertices.length = 0;
	outputIndices.length = 0;

	// Add edge endpoints and find edge-edge intersection points
	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		const edge0 = edges[ i ];
		getIndex( edge0.start );
		getIndex( edge0.end );

	}

	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		const edge0 = edges[ i ];
		for ( let i1 = i + 1; i1 < l; i1 ++ ) {

			const edge1 = edges[ i1 ];
			const dist = edge0.distanceSqToLine3( edge1, _vec$2, _vec2$1 );
			if ( dist < RELATIVE_EPSILON * epsilonScale ) {

				getIndex( _vec2$1 );

			}

		}

	}

	// Build sub-segments by finding all vertices on each edge
	const arr = [];
	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		arr.length = 0;

		const edge = edges[ i ];
		for ( let v = 0, lv = outputVertices.length; v < lv; v ++ ) {

			const vec = outputVertices[ v ];
			const param = edge.closestPointToPointParameter( vec, true );
			edge.at( param, _vec$2 );
			if ( vec.distanceToSquared( _vec$2 ) < RELATIVE_EPSILON * epsilonScale ) {

				const entry = _paramPool.getInstance();
				entry.param = param;
				entry.index = v;
				arr.push( entry );

			}

		}

		arr.sort( paramSort );

		for ( let a = 0, la = arr.length - 1; a < la; a ++ ) {

			const i0 = arr[ a ].index;
			const i1 = arr[ a + 1 ].index;

			// Skip self-loops (can arise when two endpoints merge)
			if ( i0 === i1 ) continue;

			outputIndices.push( [ i0, i1 ] );

		}

	}

	// Remove duplicate edges
	const edgeSet = new Set();
	let ptr = 0;
	for ( let i = 0, l = outputIndices.length; i < l; i ++ ) {

		const e = outputIndices[ i ];
		const lo = Math.min( e[ 0 ], e[ 1 ] );
		const hi = Math.max( e[ 0 ], e[ 1 ] );
		const key = lo + ',' + hi;
		if ( ! edgeSet.has( key ) ) {

			edgeSet.add( key );
			outputIndices[ ptr ++ ] = e;

		}

	}

	outputIndices.length = ptr;

	function paramSort( a, b ) {

		return a.param - b.param;

	}

	function getIndex( v ) {

		for ( let i = 0; i < outputVertices.length; i ++ ) {

			const v2 = outputVertices[ i ];
			if ( v === v2 || v.distanceToSquared( v2 ) < VERTEX_MERGE_EPSILON * epsilonScale ) {

				return i;

			}

		}

		outputVertices.push( _vectorPool.getInstance().copy( v ) );
		return outputVertices.length - 1;

	}

}

class CDTTriangleSplitter {

	constructor() {

		this.trianglePool = new Pool( () => new ExtendedTriangle() );
		this.linePool = new Pool( () => new Line3() );
		// TODO: use array pool

		this.triangles = [];
		this.triangleIndices = [];
		this.constrainedEdges = [];
		this.triangleConnectivity = [];

		this.normal = new Vector3();
		this.projOrigin = new Vector3();
		this.projU = new Vector3();
		this.projV = new Vector3();
		this.baseTri = new ExtendedTriangle();
		this.baseIndices = new Array( 3 );

	}

	// initialize the class with a triangle to be split
	initialize( tri, i0 = null, i1 = null, i2 = null ) {

		this.reset();

		const { normal, baseTri, projU, projV, projOrigin, constrainedEdges, linePool, baseIndices } = this;
		tri.getNormal( normal );
		baseTri.copy( tri );
		baseTri.update();
		baseIndices[ 0 ] = i0;
		baseIndices[ 1 ] = i1;
		baseIndices[ 2 ] = i2;

		// initialize constrained edges to the triangle boundary
		constrainedEdges.length = 0;

		// inserting these edges in this order guarantee that indices a, b, c will be given the
		// indices 0, 1, 2 so we can infer base indices from them later.
		const e0 = linePool.getInstance();
		e0.start.copy( baseTri.a );
		e0.end.copy( baseTri.b );

		const e1 = linePool.getInstance();
		e1.start.copy( baseTri.b );
		e1.end.copy( baseTri.c );

		const e2 = linePool.getInstance();
		e2.start.copy( baseTri.c );
		e2.end.copy( baseTri.a );
		constrainedEdges.push( e0, e1, e2 );

		// Build 2D projection frame from base triangle
		projOrigin.copy( baseTri.a );
		projU.subVectors( baseTri.b, baseTri.a ).normalize();
		projV.crossVectors( normal, projU ).normalize();

	}

	// Add a pre-computed constraint edge to the splitter
	addConstraintEdge( edge ) {

		const { constrainedEdges, linePool } = this;
		const e = linePool.getInstance().copy( edge );
		constrainedEdges.push( e );

	}

	// Project a 3D point onto the 2D frame defined by _projOrigin / _projU / _projV
	_to2D( point, target ) {

		const { projOrigin, projU, projV } = this;
		_vec$2.subVectors( point, projOrigin );
		return target.set( _vec$2.dot( projU ), _vec$2.dot( projV ), 0 );

	}

	_from2D( u, v, target ) {

		const { projOrigin, projU, projV } = this;
		target.copy( projOrigin ).addScaledVector( projU, u ).addScaledVector( projV, v );
		return target;

	}

	// Run the CDT and populate this.triangles with the result
	triangulate() {

		const { triangles, trianglePool, triangleConnectivity, triangleIndices, linePool, baseTri, constrainedEdges, baseIndices } = this;

		triangles.length = 0;
		trianglePool.clear();

		// Get the edges into a 2d frame
		const edges2d = [];
		for ( let i = 0, l = constrainedEdges.length; i < l; i ++ ) {

			const edge = constrainedEdges[ i ];
			const e2d = linePool.getInstance();
			this._to2D( edge.start, e2d.start );
			this._to2D( edge.end, e2d.end );
			edges2d.push( e2d );

		}

		// Precompute scale factor from base triangle for epsilon scaling
		let epsilonScale = 0;
		for ( let i = 0; i < 3; i ++ ) {

			const v = this._to2D( baseTri.points[ i ], _vec$2 );
			epsilonScale = Math.max( epsilonScale, Math.abs( v.x ), Math.abs( v.y ) );

		}

		// Use custom deduplication and edge splitting
		const vertices = [];
		const indices = [];
		edgesToIndices( edges2d, vertices, indices, epsilonScale );

		const cdt2dPoints = [];
		for ( let i = 0, l = vertices.length; i < l; i ++ ) {

			const vert = vertices[ i ];
			cdt2dPoints.push( [ vert.x, vert.y ] );

		}

		// Run the CDT triangulation
		const triangulation = cdt2d( cdt2dPoints, indices, { exterior: false } );

		// construct the half edge structure, marking the constrained edges as disconnected to
		// mark the polygon edges
		const halfEdgeMap = new Map();
		for ( let i = 0, l = indices.length; i < l; i ++ ) {

			const pair = indices[ i ];
			halfEdgeMap.set( `${ pair[ 0 ] }_${ pair[ 1 ] }`, - 1 );
			halfEdgeMap.set( `${ pair[ 1 ] }_${ pair[ 0 ] }`, - 1 );

		}

		// create an index key to construct unique indices across the geometry
		const indexKeyPrefix = `${ baseIndices[ 0 ] }_${ baseIndices[ 1 ] }_${ baseIndices[ 2 ] }_`;
		for ( let ti = 0, l = triangulation.length; ti < l; ti ++ ) {

			// covert back to 2d
			const indexList = triangulation[ ti ];
			const [ i0, i1, i2 ] = indexList;
			const tri = trianglePool.getInstance();
			this._from2D( cdt2dPoints[ i0 ][ 0 ], cdt2dPoints[ i0 ][ 1 ], tri.a );
			this._from2D( cdt2dPoints[ i1 ][ 0 ], cdt2dPoints[ i1 ][ 1 ], tri.b );
			this._from2D( cdt2dPoints[ i2 ][ 0 ], cdt2dPoints[ i2 ][ 1 ], tri.c );
			triangles.push( tri );

			// construct the connectivity and custom index list
			const connected = [];
			triangleConnectivity.push( connected );

			const indexKeys = [];
			triangleIndices.push( indexKeys );
			for ( let i = 0; i < 3; i ++ ) {

				// use the original geometry index for base triangle corners,
				// otherwise construct a unique index key for constraint edge vertices
				const p0 = indexList[ i ];
				indexKeys.push( p0 < 3 ? baseIndices[ p0 ] : indexKeyPrefix + p0 );

				// find the connected triangles
				const p1 = indexList[ ( i + 1 ) % 3 ];
				const hash0 = `${ p0 }_${ p1 }`;
				if ( halfEdgeMap.has( hash0 ) ) {

					const index = halfEdgeMap.get( hash0 );
					if ( index !== - 1 ) {

						connected.push( index );
						triangleConnectivity[ index ].push( ti );

					}

				} else {

					const hash1 = `${ p1 }_${ p0 }`;
					halfEdgeMap.set( hash1, ti );

				}

			}

		}

	}

	reset() {

		this.trianglePool.clear();
		this.linePool.clear();
		this.triangles.length = 0;
		this.triangleIndices.length = 0;
		this.triangleConnectivity.length = 0;
		this.constrainedEdges.length = 0;

	}

}

const EPSILON$1 = 1e-14;
const _AB = new Vector3();
const _AC = new Vector3();
const _CB = new Vector3();

function isTriDegenerate( tri, eps = EPSILON$1 ) {

	// compute angles to determine whether they're degenerate
	_AB.subVectors( tri.b, tri.a );
	_AC.subVectors( tri.c, tri.a );
	_CB.subVectors( tri.b, tri.c );

	const angle1 = _AB.angleTo( _AC );				// AB v AC
	const angle2 = _AB.angleTo( _CB );				// AB v BC
	const angle3 = Math.PI - angle1 - angle2;		// 180deg - angle1 - angle2

	return Math.abs( angle1 ) < eps ||
		Math.abs( angle2 ) < eps ||
		Math.abs( angle3 ) < eps ||
		tri.a.distanceToSquared( tri.b ) < eps ||
		tri.a.distanceToSquared( tri.c ) < eps ||
		tri.b.distanceToSquared( tri.c ) < eps;

}

// NOTE: these epsilons likely should all be the same since they're used to measure the
// distance from a point to a plane which needs to be done consistently
const EPSILON = 1e-10;
const COPLANAR_EPSILON = 1e-10;
const _edge$2 = new Line3();
const _foundEdge = new Line3();
const _vec$1 = new Vector3();
const _triangleNormal = new Vector3();
const _planeNormal = new Vector3();
const _plane$1 = new Plane();
const _splittingTriangle = new ExtendedTriangle();

// Utility class for splitting triangles
class LegacyTriangleSplitter {

	constructor() {

		this.trianglePool = new Pool( () => new Triangle() );
		this.triangles = [];
		this.normal = new Vector3();

	}

	// initialize the class with a triangle
	initialize( tri ) {

		this.reset();

		const { triangles, trianglePool, normal } = this;
		if ( Array.isArray( tri ) ) {

			for ( let i = 0, l = tri.length; i < l; i ++ ) {

				const t = tri[ i ];
				if ( i === 0 ) {

					t.getNormal( normal );

				} else if ( Math.abs( 1.0 - t.getNormal( _vec$1 ).dot( normal ) ) > EPSILON ) {

					throw new Error( 'Triangle Splitter: Cannot initialize with triangles that have different normals.' );

				}

				const poolTri = trianglePool.getInstance();
				poolTri.copy( t );
				triangles.push( poolTri );

			}

		} else {

			tri.getNormal( normal );

			const poolTri = trianglePool.getInstance();
			poolTri.copy( tri );
			triangles.push( poolTri );

		}

	}

	// Split the current set of triangles by passing a single triangle in. If the triangle is
	// coplanar it will attempt to split by the triangle edge planes
	splitByTriangle( triangle, isCoplanar ) {

		const { triangles } = this;

		if ( isCoplanar ) {

			for ( let i = 0, l = triangles.length; i < l; i ++ ) {

				const t = triangles[ i ];
				t.coplanarCount = 0;

			}

			// if the triangle is coplanar then split by the edge planes
			const arr = [ triangle.a, triangle.b, triangle.c ];
			for ( let i = 0; i < 3; i ++ ) {

				const nexti = ( i + 1 ) % 3;

				const v0 = arr[ i ];
				const v1 = arr[ nexti ];

				// plane positive direction is toward triangle center
				triangle.getNormal( _triangleNormal ).normalize();
				_vec$1.subVectors( v1, v0 ).normalize();
				_planeNormal.crossVectors( _triangleNormal, _vec$1 );
				_plane$1.setFromNormalAndCoplanarPoint( _planeNormal, v0 );

				this.splitByPlane( _plane$1, triangle );

			}

		} else {

			// otherwise split by the triangle plane
			triangle.getPlane( _plane$1 );
			this.splitByPlane( _plane$1, triangle );

		}

	}

	// Split the triangles by the given plan. If a triangle is provided then we ensure we
	// intersect the triangle before splitting the plane
	splitByPlane( plane, clippingTriangle ) {

		const { triangles, trianglePool } = this;

		// init our triangle to check for intersection
		_splittingTriangle.copy( clippingTriangle );
		_splittingTriangle.needsUpdate = true;

		// try to split every triangle in the class
		for ( let i = 0, l = triangles.length; i < l; i ++ ) {

			const tri = triangles[ i ];

			// skip the triangle if we don't intersect with it
			if ( ! _splittingTriangle.intersectsTriangle( tri, _edge$2, true ) ) {

				continue;

			}

			const { a, b, c } = tri;
			let intersects = 0;
			let vertexSplitEnd = - 1;
			let coplanarEdge = false;
			let posSideVerts = [];
			let negSideVerts = [];
			const arr = [ a, b, c ];
			for ( let t = 0; t < 3; t ++ ) {

				// get the triangle edge
				const tNext = ( t + 1 ) % 3;
				_edge$2.start.copy( arr[ t ] );
				_edge$2.end.copy( arr[ tNext ] );

				// track if the start point sits on the plane or if it's on the positive side of it
				// so we can use that information to determine whether to split later.
				const startDist = plane.distanceToPoint( _edge$2.start );
				const endDist = plane.distanceToPoint( _edge$2.end );
				if ( Math.abs( startDist ) < COPLANAR_EPSILON && Math.abs( endDist ) < COPLANAR_EPSILON ) {

					coplanarEdge = true;
					break;

				}

				if ( startDist > 0 ) {

					posSideVerts.push( t );

				} else {

					negSideVerts.push( t );

				}

				// we only don't consider this an intersection if the start points hits the plane
				if ( Math.abs( startDist ) < COPLANAR_EPSILON ) {

					continue;

				}

				// double check the end point since the "intersectLine" function sometimes does not
				// return it as an intersection (see issue #28)
				// Because we ignore the start point intersection above we have to make sure we check the end
				// point intersection here.
				let didIntersect = ! ! plane.intersectLine( _edge$2, _vec$1 );
				if ( ! didIntersect && Math.abs( endDist ) < COPLANAR_EPSILON ) {

					_vec$1.copy( _edge$2.end );
					didIntersect = true;

				}

				// check if we intersect the plane (ignoring the start point so we don't double count)
				if ( didIntersect && ! ( _vec$1.distanceTo( _edge$2.start ) < EPSILON ) ) {

					// if we intersect at the end point then we track that point as one that we
					// have to split down the middle
					if ( _vec$1.distanceTo( _edge$2.end ) < EPSILON ) {

						vertexSplitEnd = t;

					}

					// track the split edge
					if ( intersects === 0 ) {

						_foundEdge.start.copy( _vec$1 );

					} else {

						_foundEdge.end.copy( _vec$1 );

					}

					intersects ++;

				}

			}

			// skip splitting if:
			// - we have two points on the plane then the plane intersects the triangle exactly on an edge
			// - the plane does not intersect on 2 points
			// - the intersection edge is too small
			// - we're not along a coplanar edge
			if ( ! coplanarEdge && intersects === 2 && _foundEdge.distance() > COPLANAR_EPSILON ) {

				if ( vertexSplitEnd !== - 1 ) {

					vertexSplitEnd = ( vertexSplitEnd + 1 ) % 3;

					// we're splitting along a vertex
					let otherVert1 = 0;
					if ( otherVert1 === vertexSplitEnd ) {

						otherVert1 = ( otherVert1 + 1 ) % 3;

					}

					let otherVert2 = otherVert1 + 1;
					if ( otherVert2 === vertexSplitEnd ) {

						otherVert2 = ( otherVert2 + 1 ) % 3;

					}

					const nextTri = trianglePool.getInstance();
					nextTri.a.copy( arr[ otherVert2 ] );
					nextTri.b.copy( _foundEdge.end );
					nextTri.c.copy( _foundEdge.start );

					if ( ! isTriDegenerate( nextTri ) ) {

						triangles.push( nextTri );

					}

					tri.a.copy( arr[ otherVert1 ] );
					tri.b.copy( _foundEdge.start );
					tri.c.copy( _foundEdge.end );

					// finish off the adjusted triangle
					if ( isTriDegenerate( tri ) ) {

						triangles.splice( i, 1 );
						i --;
						l --;

					}

				} else {

					// we're splitting with a quad and a triangle
					// TODO: what happens when we find that about the pos and negative
					// sides have only a single vertex?
					const singleVert =
						posSideVerts.length >= 2 ?
							negSideVerts[ 0 ] :
							posSideVerts[ 0 ];

					// swap the direction of the intersection edge depending on which
					// side of the plane the single vertex is on to align with the
					// correct winding order.
					if ( singleVert === 0 ) {

						let tmp = _foundEdge.start;
						_foundEdge.start = _foundEdge.end;
						_foundEdge.end = tmp;

					}

					const nextVert1 = ( singleVert + 1 ) % 3;
					const nextVert2 = ( singleVert + 2 ) % 3;

					const nextTri1 = trianglePool.getInstance();
					const nextTri2 = trianglePool.getInstance();

					// choose the triangle that has the larger areas (shortest split distance)
					if ( arr[ nextVert1 ].distanceToSquared( _foundEdge.start ) < arr[ nextVert2 ].distanceToSquared( _foundEdge.end ) ) {

						nextTri1.a.copy( arr[ nextVert1 ] );
						nextTri1.b.copy( _foundEdge.start );
						nextTri1.c.copy( _foundEdge.end );

						nextTri2.a.copy( arr[ nextVert1 ] );
						nextTri2.b.copy( arr[ nextVert2 ] );
						nextTri2.c.copy( _foundEdge.start );

					} else {

						nextTri1.a.copy( arr[ nextVert2 ] );
						nextTri1.b.copy( _foundEdge.start );
						nextTri1.c.copy( _foundEdge.end );

						nextTri2.a.copy( arr[ nextVert1 ] );
						nextTri2.b.copy( arr[ nextVert2 ] );
						nextTri2.c.copy( _foundEdge.end );

					}

					tri.a.copy( arr[ singleVert ] );
					tri.b.copy( _foundEdge.end );
					tri.c.copy( _foundEdge.start );

					// don't add degenerate triangles to the list
					if ( ! isTriDegenerate( nextTri1 ) ) {

						triangles.push( nextTri1 );

					}

					if ( ! isTriDegenerate( nextTri2 ) ) {

						triangles.push( nextTri2 );

					}

					// finish off the adjusted triangle
					if ( isTriDegenerate( tri ) ) {

						triangles.splice( i, 1 );
						i --;
						l --;

					}

				}

			} else if ( intersects === 3 ) {

				console.warn( 'TriangleClipper: Coplanar clip not handled' );

			}

		}

	}

	reset() {

		this.triangles.length = 0;
		this.trianglePool.clear();

	}

}

class IntersectionMap {

	constructor() {

		this.coplanarSet = new Map();
		this.intersectionSet = new Map();
		this.edgeSet = new Map();
		this.ids = [];

	}

	add( id, intersectionId, coplanar = false ) {

		const { intersectionSet, coplanarSet, ids } = this;
		if ( ! intersectionSet.has( id ) ) {

			intersectionSet.set( id, [] );
			ids.push( id );

		}

		intersectionSet.get( id ).push( intersectionId );

		if ( coplanar ) {

			if ( ! coplanarSet.has( id ) ) {

				coplanarSet.set( id, new Set() );

			}

			coplanarSet.get( id ).add( intersectionId );

		}

	}

	addIntersectionEdge( id, edge ) {

		const { edgeSet } = this;
		if ( ! edgeSet.has( id ) ) {

			edgeSet.set( id, new Set() );

		}

		edgeSet.get( id ).add( edge );

	}

	getIntersectionEdges( id ) {

		return this.edgeSet.get( id ) || null;

	}

}

const ADDITION = 0;
const SUBTRACTION = 1;
const REVERSE_SUBTRACTION = 2;
const INTERSECTION = 3;
const DIFFERENCE = 4;

// guaranteed non manifold results
const HOLLOW_SUBTRACTION = 5;
const HOLLOW_INTERSECTION = 6;

// tolerance for considering a clipped segment degenerate (zero-length)
const CLIP_EPSILON = 1e-10;

// tolerance for treating a denominator as zero (segment parallel to edge)
const PARALLEL_EPSILON = 1e-15;

// tolerance for considering two triangle normals as parallel
const COPLANAR_NORMAL_EPSILON = 1e-10;

// tolerance for considering two parallel triangles as lying on the same plane
const COPLANAR_DISTANCE_EPSILON = 1e-10;

const _tempLine = new Line3();
const _inputSeg = new Line3();
const _dir = new Vector3();
const _edgeDelta = new Vector3();
const _edgeNormal = new Vector3();
const _edgePlane = new Plane();
const _normalA = new Vector3();
const _normalB = new Vector3();

// returns true if two triangles are coplanar (parallel normals and same plane distance)
function isTriangleCoplanar( triA, triB ) {

	triA.getNormal( _normalA );
	triB.getNormal( _normalB );

	const dot = _normalA.dot( _normalB );
	if ( Math.abs( 1.0 - Math.abs( dot ) ) >= COPLANAR_NORMAL_EPSILON ) {

		return false;

	}

	// test if plane constant is within tolerance
	const dA = _normalA.dot( triA.a );
	const dB = _normalA.dot( triB.a );
	return Math.abs( dA - dB ) < COPLANAR_DISTANCE_EPSILON;

}

// Clips a line segment to the interior of a coplanar triangle using the Cyrus–Beck algorithm
// generalized to 3D half-planes.
// Reference: Cyrus & Beck, "Generalized two- and three-dimensional clipping"
// Returns the target Line3 with clipped endpoints, or null if entirely outside.
function clipSegmentToTriangle( segment, tri, normal, target ) {

	let tMin = 0;
	let tMax = 1;

	segment.delta( _dir );

	const verts = [ tri.a, tri.b, tri.c ];
	for ( let i = 0; i < 3; i ++ ) {

		const v0 = verts[ i ];
		const v1 = verts[ ( i + 1 ) % 3 ];

		// build the inward-facing edge plane
		_edgeDelta.subVectors( v1, v0 );
		_edgeNormal.crossVectors( normal, _edgeDelta );
		_edgePlane.setFromNormalAndCoplanarPoint( _edgeNormal, v0 );

		// signed distance of segment start from the edge plane
		const dist = _edgePlane.distanceToPoint( segment.start );

		// rate of change of distance along segment direction
		const denom = _edgePlane.normal.dot( _dir );
		if ( Math.abs( denom ) < PARALLEL_EPSILON ) {

			// segment parallel to edge — entirely inside or outside this half-plane
			if ( dist < - CLIP_EPSILON ) {

				return null;

			} else {

				continue;

			}

		}

		const t = - dist / denom;
		if ( denom > 0 ) {

			// segment enters the plane at t from the negative side
			tMin = Math.max( tMin, t );

		} else {

			// segment exits the plane at t from the positive side
			tMax = Math.min( tMax, t );

		}

		// edge is outside the triangle
		if ( tMin > tMax + CLIP_EPSILON ) {

			return null;

		}

	}

	// segment is degenerate
	if ( tMax - tMin < CLIP_EPSILON ) {

		return null;

	}

	segment.at( tMin, target.start );
	segment.at( tMax, target.end );

	return target;

}

// Computes the edges of the intersection polygon between two coplanar triangles.
// The boundary consists of segments from both triangles' edges clipped to the other's interior.
// Returns the number of segments written into target.
function getCoplanarIntersectionEdges( triA, triB, target ) {

	let count = 0;

	triA.getNormal( _normalA );
	triB.getNormal( _normalB );

	// clip triB's edges against triA
	const bVerts = [ triB.a, triB.b, triB.c ];
	for ( let i = 0; i < 3; i ++ ) {

		_inputSeg.start.copy( bVerts[ i ] );
		_inputSeg.end.copy( bVerts[ ( i + 1 ) % 3 ] );

		const result = clipSegmentToTriangle( _inputSeg, triA, _normalA, _tempLine );
		if ( result !== null ) {

			if ( count >= target.length ) {

				target.push( new Line3() );

			}

			target[ count ].copy( result );
			count ++;

		}

	}

	// clip triA's edges against triB
	const aVerts = [ triA.a, triA.b, triA.c ];
	for ( let i = 0; i < 3; i ++ ) {

		_inputSeg.start.copy( aVerts[ i ] );
		_inputSeg.end.copy( aVerts[ ( i + 1 ) % 3 ] );

		const result = clipSegmentToTriangle( _inputSeg, triB, _normalB, _tempLine );
		if ( result !== null ) {

			if ( count >= target.length ) {

				target.push( new Line3() );

			}

			target[ count ].copy( result );
			count ++;

		}

	}

	// returns the number of segments generated
	return count;

}

const _ray$1 = new Ray();
const _matrix$2 = new Matrix4();
const _edge$1 = new Line3();
const _coplanarEdges = [];
const _edgePool = new Pool( () => new Line3() );

const BACK_SIDE = - 1;
const FRONT_SIDE = 1;
const COPLANAR_OPPOSITE = - 2;
const COPLANAR_ALIGNED = 2;

const INVERT_TRI = 0;
const ADD_TRI = 1;
const SKIP_TRI = 2;

let _debugContext = null;
function setDebugContext( debugData ) {

	_debugContext = debugData;

}

function getHitSide( tri, bvh, matrix = null ) {

	tri.getMidpoint( _ray$1.origin );
	tri.getNormal( _ray$1.direction );

	if ( matrix ) {

		_ray$1.origin.applyMatrix4( matrix );
		_ray$1.direction.transformDirection( matrix );

	}

	const hit = bvh.raycastFirst( _ray$1, DoubleSide );
	const hitBackSide = Boolean( hit && _ray$1.direction.dot( hit.face.normal ) > 0 );
	return hitBackSide ? BACK_SIDE : FRONT_SIDE;

}

// returns the intersected triangles and returns objects mapping triangle indices to
// the other triangles intersected
function collectIntersectingTriangles( a, b ) {

	const aIntersections = new IntersectionMap();
	const bIntersections = new IntersectionMap();

	_edgePool.clear();

	_matrix$2
		.copy( a.matrixWorld )
		.invert()
		.multiply( b.matrixWorld );

	a.geometry.boundsTree.bvhcast( b.geometry.boundsTree, _matrix$2, {

		intersectsTriangles( triangleA, triangleB, ia, ib ) {

			if ( ! isTriDegenerate( triangleA ) && ! isTriDegenerate( triangleB ) ) {

				// due to floating point error it's possible that we can have two overlapping, coplanar triangles
				// that are a _tiny_ fraction of a value away from each other. If we find that case then check the
				// distance between triangles and if it's small enough consider them intersecting.
				const coplanarCount = isTriangleCoplanar( triangleA, triangleB ) ? getCoplanarIntersectionEdges( triangleA, triangleB, _coplanarEdges ) : 0;
				const isCoplanarIntersection = coplanarCount > 2;
				const intersected = isCoplanarIntersection || triangleA.intersectsTriangle( triangleB, _edge$1, true );
				if ( intersected ) {

					const va = a.geometry.boundsTree.resolveTriangleIndex( ia );
					const vb = b.geometry.boundsTree.resolveTriangleIndex( ib );
					aIntersections.add( va, vb, isCoplanarIntersection );
					bIntersections.add( vb, va, isCoplanarIntersection );

					// cache intersection edges in geometry A's local frame
					if ( isCoplanarIntersection ) {

						// coplanar
						const count = getCoplanarIntersectionEdges( triangleA, triangleB, _coplanarEdges );
						for ( let i = 0; i < count; i ++ ) {

							const e = _edgePool.getInstance().copy( _coplanarEdges[ i ] );
							aIntersections.addIntersectionEdge( va, e );
							bIntersections.addIntersectionEdge( vb, e );

						}

					} else {

						// non-coplanar
						const ea = _edgePool.getInstance().copy( _edge$1 );
						const eb = _edgePool.getInstance().copy( _edge$1 );
						aIntersections.addIntersectionEdge( va, ea );
						bIntersections.addIntersectionEdge( vb, eb );

					}

					if ( _debugContext ) {

						_debugContext.addEdge( _edge$1 );
						_debugContext.addIntersectingTriangles( ia, triangleA, ib, triangleB );

					}

				}

			}

			return false;

		}

	} );

	return { aIntersections, bIntersections };

}

// Returns the triangle to add when performing an operation
function getOperationAction( operation, hitSide, invert = false ) {

	switch ( operation ) {

		case ADDITION:

			if ( hitSide === FRONT_SIDE || ( hitSide === COPLANAR_ALIGNED && ! invert ) ) {

				return ADD_TRI;

			}

			break;
		case SUBTRACTION:

			if ( invert ) {

				if ( hitSide === BACK_SIDE ) {

					return INVERT_TRI;

				}

			} else {

				if ( hitSide === FRONT_SIDE || hitSide === COPLANAR_OPPOSITE ) {

					return ADD_TRI;

				}

			}

			break;
		case REVERSE_SUBTRACTION:

			if ( invert ) {

				if ( hitSide === FRONT_SIDE || hitSide === COPLANAR_OPPOSITE ) {

					return ADD_TRI;

				}

			} else {

				if ( hitSide === BACK_SIDE ) {

					return INVERT_TRI;

				}

			}

			break;
		case DIFFERENCE:

			if ( hitSide === BACK_SIDE ) {

				return INVERT_TRI;

			} else if ( hitSide === FRONT_SIDE ) {

				return ADD_TRI;

			}

			break;
		case INTERSECTION:
			if ( hitSide === BACK_SIDE || ( hitSide === COPLANAR_ALIGNED && ! invert ) ) {

				return ADD_TRI;

			}

			break;

		case HOLLOW_SUBTRACTION:
			if ( ! invert && ( hitSide === FRONT_SIDE || hitSide === COPLANAR_OPPOSITE ) ) {

				return ADD_TRI;

			}

			break;
		case HOLLOW_INTERSECTION:
			if ( ! invert && ( hitSide === BACK_SIDE || hitSide === COPLANAR_ALIGNED ) ) {

				return ADD_TRI;

			}

			break;
		default:
			throw new Error( `Unrecognized CSG operation enum "${ operation }".` );

	}

	return SKIP_TRI;

}

class TriangleIntersectData {

	constructor( tri ) {

		this.triangle = new Triangle().copy( tri );
		this.intersects = {};

	}

	addTriangle( index, tri ) {

		this.intersects[ index ] = new Triangle().copy( tri );

	}

	getIntersectArray() {

		const array = [];
		const { intersects } = this;
		for ( const key in intersects ) {

			array.push( intersects[ key ] );

		}

		return array;

	}

}

class TriangleIntersectionSets {

	constructor() {

		this.data = {};

	}

	addTriangleIntersection( ia, triA, ib, triB ) {

		const { data } = this;
		if ( ! data[ ia ] ) {

			data[ ia ] = new TriangleIntersectData( triA );

		}

		data[ ia ].addTriangle( ib, triB );

	}

	getTrianglesAsArray( id = null ) {

		const { data } = this;
		const arr = [];

		if ( id !== null ) {

			if ( id in data ) {

				arr.push( data[ id ].triangle );

			}

		} else {

			for ( const key in data ) {

				arr.push( data[ key ].triangle );

			}

		}

		return arr;

	}

	getTriangleIndices() {

		return Object.keys( this.data ).map( i => parseInt( i ) );

	}

	getIntersectionIndices( id ) {

		const { data } = this;
		if ( ! data[ id ] ) {

			return [];

		} else {

			return Object.keys( data[ id ].intersects ).map( i => parseInt( i ) );


		}

	}

	getIntersectionsAsArray( id = null, id2 = null ) {

		const { data } = this;
		const triSet = new Set();
		const arr = [];

		const addTriangles = key => {

			if ( ! data[ key ] ) return;

			if ( id2 !== null ) {

				if ( data[ key ].intersects[ id2 ] ) {

					arr.push( data[ key ].intersects[ id2 ] );

				}

			} else {

				const intersects = data[ key ].intersects;
				for ( const key2 in intersects ) {

					if ( ! triSet.has( key2 ) ) {

						triSet.add( key2 );
						arr.push( intersects[ key2 ] );

					}

				}

			}

		};

		if ( id !== null ) {

			addTriangles( id );

		} else {

			for ( const key in data ) {

				addTriangles( key );

			}

		}

		return arr;

	}

	reset() {

		this.data = {};

	}

}

class OperationDebugData {

	constructor() {

		this.enabled = false;
		this.triangleIntersectsA = new TriangleIntersectionSets();
		this.triangleIntersectsB = new TriangleIntersectionSets();
		this.intersectionEdges = [];

	}

	addIntersectingTriangles( ia, triA, ib, triB ) {

		const { triangleIntersectsA, triangleIntersectsB } = this;
		triangleIntersectsA.addTriangleIntersection( ia, triA, ib, triB );
		triangleIntersectsB.addTriangleIntersection( ib, triB, ia, triA );

	}

	addEdge( edge ) {

		this.intersectionEdges.push( edge.clone() );

	}

	reset() {

		this.triangleIntersectsA.reset();
		this.triangleIntersectsB.reset();
		this.intersectionEdges = [];

	}

	init() {

		if ( this.enabled ) {

			this.reset();
			setDebugContext( this );

		}

	}

	complete() {

		if ( this.enabled ) {

			setDebugContext( null );

		}

	}

}

const _matrix$1 = new Matrix4();
const _inverseMatrix = new Matrix4();
const _builderMatrix = new Matrix4();
const _normalMatrix = new Matrix3();
const _triA = new Triangle();
const _triB = new Triangle();
const _tri$1 = new Triangle();
const _barycoordTri = new Triangle();
const _actions = [];
const _builders = [];
const _traversed = new Set();
const _midpoint = new Vector3();
const _normal$1 = new Vector3();
const _coplanarTrianglePool = new Pool( () => new Triangle() );
const _coplanarNormal = new Vector3();
const _coplanarTriangles = [];

// runs the given operation against a and b using the splitter and appending data to the
// geometry builder.
function performOperation(
	a,
	b,
	operations,
	splitter,
	builders,
	options = {},
) {

	const { useGroups = true } = options;
	const { aIntersections, bIntersections } = collectIntersectingTriangles( a, b );

	const resultGroups = [];
	let resultMaterials = null;

	let groupOffset;
	groupOffset = useGroups ? 0 : - 1;
	performWholeTriangleOperations( a, b, aIntersections, operations, false, builders, groupOffset );
	performSplitTriangleOperations( a, b, aIntersections, operations, false, splitter, builders, groupOffset );

	// find whether the set of operations contains a non-hollow operations. If it does then we need
	// to perform the second set of triangle additions
	const nonHollow = operations
		.findIndex( op => op !== HOLLOW_INTERSECTION && op !== HOLLOW_SUBTRACTION ) !== - 1;

	if ( nonHollow ) {

		// clear the index map so for the new geometry being used
		builders.forEach( builder => builder.clearIndexMap() );

		groupOffset = useGroups ? a.geometry.groups.length || 1 : - 1;
		performWholeTriangleOperations( b, a, bIntersections, operations, true, builders, groupOffset );
		performSplitTriangleOperations( b, a, bIntersections, operations, true, splitter, builders, groupOffset );

	}

	// clear the shared info
	builders.forEach( builder => builder.clearIndexMap() );
	_actions.length = 0;

	return {
		groups: resultGroups,
		materials: resultMaterials
	};

}

// perform triangle splitting and CSG operations on the set of split triangles
function performSplitTriangleOperations(
	a,
	b,
	intersectionMap,
	operations,
	invert,
	splitter,
	builders,
	groupOffset = 0,
) {

	// transform from a frame -> b frame. When "invert" is true the "b" is the first argument (brush A).
	_matrix$1
		.copy( b.matrixWorld )
		.invert()
		.multiply( a.matrixWorld );

	_inverseMatrix
		.copy( _matrix$1 )
		.invert();

	// matrix for geometry construction to transform vertices in the brush A's frame
	if ( invert ) {

		_builderMatrix.copy( _matrix$1 );

	} else {

		_builderMatrix.identity();

	}

	const invertedGeometry = _builderMatrix.determinant() < 0;
	_normalMatrix
		.getNormalMatrix( _builderMatrix )
		.multiplyScalar( invertedGeometry ? - 1 : 1 );

	const groupIndices = a.geometry.groupIndices;
	const aIndex = a.geometry.index;
	const aPosition = a.geometry.attributes.position;

	const bBVH = b.geometry.boundsTree;
	const bIndex = b.geometry.index;
	const bPosition = b.geometry.attributes.position;
	const splitIds = intersectionMap.ids;

	// iterate over all split triangle indices
	for ( let i = 0, l = splitIds.length; i < l; i ++ ) {

		const ia = splitIds[ i ];
		const groupIndex = groupOffset === - 1 ? 0 : groupIndices[ ia ] + groupOffset;

		// get the triangle in the common frame (brush A's local)
		const ia3 = 3 * ia;
		let ia0 = ia3 + 0;
		let ia1 = ia3 + 1;
		let ia2 = ia3 + 2;
		if ( aIndex ) {

			ia0 = aIndex.getX( ia0 );
			ia1 = aIndex.getX( ia1 );
			ia2 = aIndex.getX( ia2 );

		}

		_triA.a.fromBufferAttribute( aPosition, ia0 );
		_triA.b.fromBufferAttribute( aPosition, ia1 );
		_triA.c.fromBufferAttribute( aPosition, ia2 );
		if ( invert ) {

			_triA.a.applyMatrix4( _matrix$1 );
			_triA.b.applyMatrix4( _matrix$1 );
			_triA.c.applyMatrix4( _matrix$1 );

		}

		// initialize the splitter with the triangle from geometry A
		splitter.reset();
		splitter.initialize( _triA, ia0, ia1, ia2 );

		// add coplanar triangles from B to the splitter for later classification
		_coplanarTriangles.length = 0;
		_coplanarTrianglePool.clear();
		_triA.getNormal( _normal$1 );

		const coplanarIndices = intersectionMap.coplanarSet.get( ia );
		if ( coplanarIndices ) {

			for ( const index of coplanarIndices ) {

				const ib3 = 3 * index;
				let ib0 = ib3 + 0;
				let ib1 = ib3 + 1;
				let ib2 = ib3 + 2;

				if ( bIndex ) {

					ib0 = bIndex.getX( ib0 );
					ib1 = bIndex.getX( ib1 );
					ib2 = bIndex.getX( ib2 );

				}

				const inst = _coplanarTrianglePool.getInstance();
				inst.a.fromBufferAttribute( bPosition, ib0 );
				inst.b.fromBufferAttribute( bPosition, ib1 );
				inst.c.fromBufferAttribute( bPosition, ib2 );

				// transform into the common frame when needed
				if ( ! invert ) {

					inst.a.applyMatrix4( _inverseMatrix );
					inst.b.applyMatrix4( _inverseMatrix );
					inst.c.applyMatrix4( _inverseMatrix );

				}

				_coplanarTriangles.push( inst );

			}

		}

		// split the triangle using cached edges from the bvhcast phase
		if ( splitter.addConstraintEdge ) {

			// edges are already in the common frame (brush A's local) — no transform needed
			const edges = intersectionMap.getIntersectionEdges( ia );
			if ( edges ) {

				for ( const edge of edges ) {

					splitter.addConstraintEdge( edge );

				}

			}

			splitter.triangulate();

		} else {

			// split the triangle with the intersecting triangles from B
			const intersectionSet = intersectionMap.intersectionSet;
			const intersectingIndices = intersectionSet.get( ia );
			for ( let ib = 0, l = intersectingIndices.length; ib < l; ib ++ ) {

				const index = intersectingIndices[ ib ];
				const isCoplanar = coplanarIndices && coplanarIndices.has( index );
				const ib3 = 3 * index;
				let ib0 = ib3 + 0;
				let ib1 = ib3 + 1;
				let ib2 = ib3 + 2;

				if ( bIndex ) {

					ib0 = bIndex.getX( ib0 );
					ib1 = bIndex.getX( ib1 );
					ib2 = bIndex.getX( ib2 );

				}

				_triB.a.fromBufferAttribute( bPosition, ib0 );
				_triB.b.fromBufferAttribute( bPosition, ib1 );
				_triB.c.fromBufferAttribute( bPosition, ib2 );

				// transform splitting tris into the common frame when needed
				if ( ! invert ) {

					_triB.a.applyMatrix4( _inverseMatrix );
					_triB.b.applyMatrix4( _inverseMatrix );
					_triB.c.applyMatrix4( _inverseMatrix );

				}

				splitter.splitByTriangle( _triB, isCoplanar );

			}

		}


		// cache all the attribute data in origA's local frame
		const { triangles, triangleIndices = [], triangleConnectivity = [] } = splitter;
		for ( let i = 0, l = builders.length; i < l; i ++ ) {

			builders[ i ].initInterpolatedAttributeData( a.geometry, _builderMatrix, _normalMatrix, ia0, ia1, ia2 );

		}

		// for all triangles in the split result
		_traversed.clear();
		for ( let ib = 0, l = triangles.length; ib < l; ib ++ ) {

			// skip the triangle if we've already traversed
			if ( _traversed.has( ib ) ) {

				continue;

			}

			// try to use the side derived from the clipping but if it turns out to be
			// uncertain then fall back to the raycasting approach.
			// If checking the sided ness against brush B's BVH then we need to transform
			// into the appropriate frame
			const clippedTri = triangles[ ib ];
			const raycastMatrix = invert ? null : _matrix$1;
			let hitSide = null;

			// check against the set of coplanar triangles to see if we can easily determine what to do
			clippedTri.getMidpoint( _midpoint );
			for ( let cp = 0, cpl = _coplanarTriangles.length; cp < cpl; cp ++ ) {

				const cpt = _coplanarTriangles[ cp ];
				if ( cpt.containsPoint( _midpoint ) ) {

					cpt.getNormal( _coplanarNormal );
					hitSide = _normal$1.dot( _coplanarNormal ) > 0 ? COPLANAR_ALIGNED : COPLANAR_OPPOSITE;
					break;

				}

			}

			// if the clipped triangle is no coplanar then fall back to raycasting
			if ( hitSide === null ) {

				hitSide = getHitSide( clippedTri, bBVH, raycastMatrix );

			}

			_actions.length = 0;
			_builders.length = 0;

			// determine action to take for each builder
			for ( let o = 0, lo = operations.length; o < lo; o ++ ) {

				const op = getOperationAction( operations[ o ], hitSide, invert );
				if ( op !== SKIP_TRI ) {

					_actions.push( op );
					_builders.push( builders[ o ] );

				}

			}

			if ( _builders.length !== 0 ) {

				// traverse the connectivity of the triangles to add them to the geometry
				const stack = [ ib ];
				while ( stack.length > 0 ) {

					const index = stack.pop();
					if ( _traversed.has( index ) ) {

						continue;

					}

					// mark this triangle as traversed
					_traversed.add( index );

					// TODO: this is being skipped for now due to the connectivity graph not
					// including small connections due to floating point error. Adding support
					// for symmetric vertices across half edges may help this.
					// push the connected triangle ids onto the stack
					// const connected = triangleConnectivity[ index ] || [];
					// for ( let c = 0, l = connected.length; c < l; c ++ ) {

					// 	const connectedIndex = connected[ c ];
					// 	if ( triangles[ connectedIndex ] !== null ) {

					// 		stack.push( connectedIndex );

					// 	}

					// }

					// get the triangle indices
					const indices = triangleIndices[ index ];
					let t0 = null, t1 = null, t2 = null;
					if ( indices ) {

						t0 = indices[ 0 ];
						t1 = indices[ 1 ];
						t2 = indices[ 2 ];

					}

					// get the barycentric coordinates relative to the base triangle
					const tri = triangles[ index ];
					_triA.getBarycoord( tri.a, _barycoordTri.a );
					_triA.getBarycoord( tri.b, _barycoordTri.b );
					_triA.getBarycoord( tri.c, _barycoordTri.c );

					// append the triangle to all builders
					for ( let k = 0, lk = _builders.length; k < lk; k ++ ) {

						const builder = _builders[ k ];
						const action = _actions[ k ];
						const invertTri = action === INVERT_TRI;
						const invert = invertedGeometry !== invertTri;

						builder.appendInterpolatedAttributeData( groupIndex, _barycoordTri.a, t0, invert );
						if ( invert ) {

							builder.appendInterpolatedAttributeData( groupIndex, _barycoordTri.c, t2, invert );
							builder.appendInterpolatedAttributeData( groupIndex, _barycoordTri.b, t1, invert );

						} else {

							builder.appendInterpolatedAttributeData( groupIndex, _barycoordTri.b, t1, invert );
							builder.appendInterpolatedAttributeData( groupIndex, _barycoordTri.c, t2, invert );

						}

					}

				}

			}

		}

	}

	return splitIds.length;

}

// perform CSG operations on the set of whole triangles using a half edge structure
// at the moment this isn't always faster due to overhead of building the half edge structure
// and degraded connectivity due to split triangles.
function performWholeTriangleOperations(
	a,
	b,
	splitTriSet,
	operations,
	invert,
	builders,
	groupOffset = 0,
) {

	// _matrix transforms from a's local frame into the common frame (brush A's local)
	_matrix$1
		.copy( b.matrixWorld )
		.invert()
		.multiply( a.matrixWorld );

	if ( invert ) {

		_builderMatrix.copy( _matrix$1 );

	} else {

		_builderMatrix.identity();

	}

	const invertedGeometry = _builderMatrix.determinant() < 0;
	_normalMatrix
		.getNormalMatrix( _builderMatrix )
		.multiplyScalar( invertedGeometry ? - 1 : 1 );

	const bBVH = b.geometry.boundsTree;
	const groupIndices = a.geometry.groupIndices;
	const aIndex = a.geometry.index;
	const aAttributes = a.geometry.attributes;
	const aPosition = aAttributes.position;

	const stack = [];
	const halfEdges = a.geometry.halfEdges;

	// iterate over every whole triangle, skipping those that are clipped
	const traversedSet = new Set( splitTriSet.ids );
	const triCount = getTriCount( a.geometry );
	for ( let id = 0; id < triCount; id ++ ) {

		// if we've iterated over every triangle then stop
		if ( traversedSet.size === triCount ) {

			break;

		}

		// skip this triangle if we've already traversed it
		if ( traversedSet.has( id ) ) {

			continue;

		}

		// track the traversal
		traversedSet.add( id );
		stack.push( id );

		// get the vertex indices
		const i3 = 3 * id;
		let i0 = i3 + 0;
		let i1 = i3 + 1;
		let i2 = i3 + 2;
		if ( aIndex ) {

			i0 = aIndex.getX( i0 );
			i1 = aIndex.getX( i1 );
			i2 = aIndex.getX( i2 );

		}

		// get the vertex position in the common frame (origA's local) for hit testing
		_tri$1.a.fromBufferAttribute( aPosition, i0 );
		_tri$1.b.fromBufferAttribute( aPosition, i1 );
		_tri$1.c.fromBufferAttribute( aPosition, i2 );
		if ( invert ) {

			_tri$1.a.applyMatrix4( _matrix$1 );
			_tri$1.b.applyMatrix4( _matrix$1 );
			_tri$1.c.applyMatrix4( _matrix$1 );

		}

		// get the side and decide if we need to cull the triangle based on the operation.
		// When !invert, pass _matrix to transform the ray into brush B's BVH frame.
		const hitSide = getHitSide( _tri$1, bBVH, invert ? null : _matrix$1 );

		// find all attribute sets to append the triangle to
		_actions.length = 0;
		_builders.length = 0;
		for ( let o = 0, lo = operations.length; o < lo; o ++ ) {

			const op = getOperationAction( operations[ o ], hitSide, invert );
			if ( op !== SKIP_TRI ) {

				_actions.push( op );
				_builders.push( builders[ o ] );

			}

		}

		// continue to iterate on the stack until every triangle has been handled
		while ( stack.length > 0 ) {

			const currId = stack.pop();
			for ( let i = 0; i < 3; i ++ ) {

				const sid = halfEdges.getSiblingTriangleIndex( currId, i );
				if ( sid !== - 1 && ! traversedSet.has( sid ) ) {

					stack.push( sid );
					traversedSet.add( sid );

				}

			}

			if ( _builders.length !== 0 ) {

				const i3 = 3 * currId;
				let i0 = i3 + 0;
				let i1 = i3 + 1;
				let i2 = i3 + 2;
				if ( aIndex ) {

					i0 = aIndex.getX( i0 );
					i1 = aIndex.getX( i1 );
					i2 = aIndex.getX( i2 );

				}

				const groupIndex = groupOffset === - 1 ? 0 : groupIndices[ currId ] + groupOffset;

				_tri$1.a.fromBufferAttribute( aPosition, i0 );
				_tri$1.b.fromBufferAttribute( aPosition, i1 );
				_tri$1.c.fromBufferAttribute( aPosition, i2 );
				if ( ! isTriDegenerate( _tri$1 ) ) {

					for ( let k = 0, lk = _builders.length; k < lk; k ++ ) {

						const builder = _builders[ k ];
						const action = _actions[ k ];
						const invertTri = action === INVERT_TRI;
						const invert = invertTri !== invertedGeometry;
						builder.appendIndexFromGeometry( a.geometry, _builderMatrix, _normalMatrix, groupIndex, i0, invert );

						if ( invert ) {

							builder.appendIndexFromGeometry( a.geometry, _builderMatrix, _normalMatrix, groupIndex, i2, invert );
							builder.appendIndexFromGeometry( a.geometry, _builderMatrix, _normalMatrix, groupIndex, i1, invert );

						} else {

							builder.appendIndexFromGeometry( a.geometry, _builderMatrix, _normalMatrix, groupIndex, i1, invert );
							builder.appendIndexFromGeometry( a.geometry, _builderMatrix, _normalMatrix, groupIndex, i2, invert );

						}

					}

				}

			}

		}

	}

}

function ceilToFourByteStride( byteLength ) {

	byteLength = ~ ~ byteLength;
	return byteLength + 4 - byteLength % 4;

}

// Make a new array wrapper class that more easily affords expansion when reaching it's max capacity
class TypeBackedArray {

	constructor( type, initialSize = 500 ) {

		this.expansionFactor = 1.5;
		this.type = type;
		this.length = 0;
		this.array = null;

		this.setSize( initialSize );

	}

	setType( type ) {

		if ( type === this.type ) {

			return;

		}

		if ( this.length !== 0 ) {

			throw new Error( 'TypeBackedArray: Cannot change the type while there is used data in the buffer.' );

		}

		const buffer = this.array.buffer;
		this.array = new type( buffer );
		this.type = type;

	}

	setSize( size ) {

		if ( this.array && size === this.array.length ) {

			return;

		}

		// ceil to the nearest 4 bytes so we can replace the array with any type using the same buffer
		const type = this.type;
		const bufferType = areSharedArrayBuffersSupported() ? SharedArrayBuffer : ArrayBuffer;
		const newArray = new type( new bufferType( ceilToFourByteStride( size * type.BYTES_PER_ELEMENT ) ) );
		if ( this.array ) {

			newArray.set( this.array, 0 );

		}

		this.array = newArray;

	}

	expand() {

		const { array, expansionFactor } = this;
		this.setSize( array.length * expansionFactor );

	}

	push( ...args ) {

		let { array, length } = this;
		if ( length + args.length > array.length ) {

			this.expand();
			array = this.array;

		}

		for ( let i = 0, l = args.length; i < l; i ++ ) {

			array[ length + i ] = args[ i ];

		}

		this.length += args.length;

	}

	clear() {

		this.length = 0;

	}

}

const _vec3 = new Vector3();
const _vec3_0 = new Vector3();
const _vec3_1 = new Vector3();
const _vec3_2 = new Vector3();

const _vec4 = new Vector4();
const _vec4_0 = new Vector4();
const _vec4_1 = new Vector4();
const _vec4_2 = new Vector4();

function getBarycoordValue( a, b, c, barycoord, target, normalize = false, invert = false ) {

	target.set( 0, 0, 0, 0 )
		.addScaledVector( a, barycoord.x )
		.addScaledVector( b, barycoord.y )
		.addScaledVector( c, barycoord.z );

	if ( normalize ) {

		target.normalize();

	}

	if ( invert ) {

		target.multiplyScalar( - 1 );

	}

	return target;

}

function pushItemSize( vec, itemSize, target ) {

	switch ( itemSize ) {

		case 1:
			target.push( vec.x );
			break;

		case 2:
			target.push( vec.x, vec.y );
			break;

		case 3:
			target.push( vec.x, vec.y, vec.z );
			break;

		case 4:
			target.push( vec.x, vec.y, vec.z, vec.w );
			break;

	}

}

class AttributeData extends TypeBackedArray {

	get count() {

		return this.length / this.itemSize;

	}

	constructor( ...args ) {

		super( ...args );
		this.itemSize = 1;
		this.normalized = false;


	}

}

class GeometryBuilder {

	constructor() {

		this.attributeData = {};
		this.groupIndices = [];
		this.forwardIndexMap = new Map();
		this.invertedIndexMap = new Map();
		this.interpolatedFields = {};

	}

	initFromGeometry( referenceGeometry, relevantAttributes ) {

		this.clear();

		// initialize and clear unused data from the attribute buffers and vice versa
		const { attributeData } = this;
		const refAttributes = referenceGeometry.attributes;
		for ( let i = 0, l = relevantAttributes.length; i < l; i ++ ) {

			const key = relevantAttributes[ i ];
			const refAttr = refAttributes[ key ];
			const type = refAttr.array.constructor;
			if ( ! attributeData[ key ] ) {

				attributeData[ key ] = new AttributeData( type );

			}

			attributeData[ key ].setType( type );
			attributeData[ key ].itemSize = refAttr.itemSize;
			attributeData[ key ].normalized = refAttr.normalized;

		}

		for ( const key in attributeData.attributes ) {

			if ( ! relevantAttributes.includes( key ) ) {

				attributeData.delete( key );

			}

		}

	}

	// init and cache all the attribute data for the given indices so we can use it to append interpolated attribute data
	initInterpolatedAttributeData( geometry, matrix, normalMatrix, i0, i1, i2 ) {

		const { attributeData, interpolatedFields } = this;
		const { attributes } = geometry;

		for ( const key in attributeData ) {

			const attr = attributes[ key ];
			if ( ! attr ) {

				throw new Error( `CSG Operations: Attribute ${ key } not available on geometry.` );

			}

			// handle normals and positions specially because they require transforming
			let v0, v1, v2;
			if ( key === 'position' ) {

				v0 = _vec3_0.fromBufferAttribute( attr, i0 ).applyMatrix4( matrix );
				v1 = _vec3_1.fromBufferAttribute( attr, i1 ).applyMatrix4( matrix );
				v2 = _vec3_2.fromBufferAttribute( attr, i2 ).applyMatrix4( matrix );

			} else if ( key === 'normal' ) {

				v0 = _vec3_0.fromBufferAttribute( attr, i0 ).applyNormalMatrix( normalMatrix );
				v1 = _vec3_1.fromBufferAttribute( attr, i1 ).applyNormalMatrix( normalMatrix );
				v2 = _vec3_2.fromBufferAttribute( attr, i2 ).applyNormalMatrix( normalMatrix );

			} else if ( key === 'tangent' ) {

				v0 = _vec3_0.fromBufferAttribute( attr, i0 ).transformDirection( matrix );
				v1 = _vec3_1.fromBufferAttribute( attr, i1 ).transformDirection( matrix );
				v2 = _vec3_2.fromBufferAttribute( attr, i2 ).transformDirection( matrix );

			} else {

				v0 = _vec4_0.fromBufferAttribute( attr, i0 );
				v1 = _vec4_1.fromBufferAttribute( attr, i1 );
				v2 = _vec4_2.fromBufferAttribute( attr, i2 );

			}

			if ( ! interpolatedFields[ key ] ) {

				interpolatedFields[ key ] = [ v0.clone(), v1.clone(), v2.clone() ];

			} else {

				const fields = interpolatedFields[ key ];
				fields[ 0 ].copy( v0 );
				fields[ 1 ].copy( v1 );
				fields[ 2 ].copy( v2 );

			}

		}

	}

	// push data from the given barycoord onto the geometry
	appendInterpolatedAttributeData( group, barycoord, index = null, invert = false ) {

		const { groupIndices, attributeData, interpolatedFields, forwardIndexMap, invertedIndexMap } = this;
		while ( groupIndices.length <= group ) {

			groupIndices.push( new AttributeData( Uint32Array ) );

		}

		const indexMap = invert ? invertedIndexMap : forwardIndexMap;
		const indexData = groupIndices[ group ];
		if ( index !== null && indexMap.has( index ) ) {

			indexData.push( indexMap.get( index ) );

		} else {

			indexMap.set( index, attributeData.position.count );
			indexData.push( attributeData.position.count );

			for ( const key in interpolatedFields ) {

				// handle normals and positions specially because they require transforming
				const arr = attributeData[ key ];
				const isDirection = key === 'normal' || key === 'tangent';
				const invertVector = invert && isDirection;
				const itemSize = arr.itemSize;
				const [ v0, v1, v2 ] = interpolatedFields[ key ];
				getBarycoordValue( v0, v1, v2, barycoord, _vec4, isDirection, invertVector );
				pushItemSize( _vec4, itemSize, arr );

			}

		}

	}

	// append the given vertex index from the source geometry to this one
	appendIndexFromGeometry( geometry, matrix, normalMatrix, group, index, invert = false ) {

		const { groupIndices, attributeData, forwardIndexMap, invertedIndexMap } = this;
		while ( groupIndices.length <= group ) {

			groupIndices.push( new AttributeData( Uint32Array ) );

		}

		const indexMap = invert ? invertedIndexMap : forwardIndexMap;
		const indexData = groupIndices[ group ];
		if ( index !== null && indexMap.has( index ) ) {

			indexData.push( indexMap.get( index ) );

		} else {

			indexMap.set( index, attributeData.position.count );
			indexData.push( attributeData.position.count );

			const { attributes } = geometry;
			for ( const key in attributeData ) {

				const arr = attributeData[ key ];
				const attr = attributes[ key ];
				if ( ! attr ) {

					throw new Error( `CSG Operations: Attribute ${ key } not available on geometry.` );

				}

				// specially handle the position and normal attributes because they require transforms
				const itemSize = attr.itemSize;
				if ( key === 'position' ) {

					_vec3.fromBufferAttribute( attr, index ).applyMatrix4( matrix );
					arr.push( _vec3.x, _vec3.y, _vec3.z );

				} else if ( key === 'normal' ) {

					_vec3.fromBufferAttribute( attr, index ).applyNormalMatrix( normalMatrix );
					if ( invert ) {

						_vec3.multiplyScalar( - 1 );

					}

					arr.push( _vec3.x, _vec3.y, _vec3.z );

				} else if ( key === 'tangent' ) {

					_vec3.fromBufferAttribute( attr, index ).transformDirection( matrix );
					if ( invert ) {

						_vec3.multiplyScalar( - 1 );

					}

					arr.push( _vec3.x, _vec3.y, _vec3.z );

				} else {

					_vec4.fromBufferAttribute( attr, index );
					pushItemSize( _vec4, itemSize, arr );

				}

			}

		}

	}

	buildGeometry( target, groupOrder ) {

		let needsDisposal = false;
		const { groupIndices, attributeData } = this;
		const { attributes, index } = target;
		for ( const key in attributeData ) {

			const arr = attributeData[ key ];
			const { type, itemSize, normalized, length, count } = arr;
			const buffer = arr.array.buffer;

			let attr = attributes[ key ];
			if ( ! attr || attr.count < count || attr.array.type !== type ) {

				// create the attribute if it doesn't exist yet
				attr = new BufferAttribute( new type( length ), itemSize, normalized );
				target.setAttribute( key, attr );
				needsDisposal = true;

			}

			// copy the data
			attr.array.set( new type( buffer, 0, length ), 0 );
			attr.needsUpdate = true;

		}

		// remove or update the index appropriately
		const indexCount = groupIndices.reduce( ( v, arr ) => arr.count + v, 0 );
		if ( ! target.index || index.count < indexCount || index.array.type !== Uint32Array ) {

			target.setIndex( new BufferAttribute( new Uint32Array( indexCount ), 1 ) );
			needsDisposal = true;

		}

		// initialize the groups
		target.clearGroups();

		let offset = 0;
		for ( let i = 0, l = Math.min( groupOrder.length, groupIndices.length ); i < l; i ++ ) {

			const { index, materialIndex } = groupOrder[ i ];
			const { count } = groupIndices[ index ];
			const buffer = groupIndices[ index ].array.buffer;
			if ( count !== 0 ) {

				target.index.array.set( new Uint32Array( buffer, 0, count ), offset );
				target.addGroup( offset, count, materialIndex );
				offset += count;

			}

		}

		// update the draw range
		target.setDrawRange( 0, offset );

		// remove the bounds tree if it exists because its now out of date
		// TODO: can we have this dispose in the same way that a brush does?
		// TODO: why are half edges and group indices not removed here?
		target.boundsTree = null;
		target.boundingBox = null;
		target.boundingSphere = null;

		if ( needsDisposal ) {

			target.dispose();

		}

	}

	clearIndexMap() {

		this.forwardIndexMap.clear();
		this.invertedIndexMap.clear();

	}

	clear() {

		const { groupIndices, attributeData } = this;

		this.interpolatedFields = {};

		for ( const key in attributeData ) {

			attributeData[ key ].clear();

		}

		groupIndices.forEach( arr => {

			arr.clear();

		} );
		this.clearIndexMap();

	}

}

function trimAttributes( targetGeometry, relevantAttributes ) {

	for ( const key in targetGeometry.attributes ) {

		if ( ! relevantAttributes.includes( key ) ) {

			targetGeometry.deleteAttribute( key );
			targetGeometry.dispose();

		}

	}

	return targetGeometry;

}

// writes new groups to point to the same material index in the given materials array
function useCommonMaterials( groups, materials ) {

	const result = [];
	for ( let i = 0, l = groups.length; i < l; i ++ ) {

		const group = groups[ i ];
		const mat = materials[ group.materialIndex ];
		result.push( {
			...group,
			materialIndex: materials.indexOf( mat ),
		} );

	}

	return result;

}

// returns a new list of materials and modifies the groups in place to reference those materials
function removeUnusedMaterials( groups, materials ) {

	const newMaterials = [];
	const indexMap = new Map();
	for ( let g = 0, lg = groups.length; g < lg; g ++ ) {

		const group = groups[ g ];
		if ( ! indexMap.has( group.materialIndex ) ) {

			indexMap.set( group.materialIndex, newMaterials.length );
			newMaterials.push( materials[ group.materialIndex ] );

		}

		group.materialIndex = indexMap.get( group.materialIndex );

	}

	return newMaterials;

}

// merges groups with common material indices in place
function joinGroups( groups ) {

	for ( let i = 0; i < groups.length - 1; i ++ ) {

		const group = groups[ i ];
		const nextGroup = groups[ i + 1 ];
		if ( group.materialIndex === nextGroup.materialIndex ) {

			const start = group.start;
			const end = nextGroup.start + nextGroup.count;
			nextGroup.start = start;
			nextGroup.count = end - start;

			groups.splice( i, 1 );
			i --;

		}

	}

}


// Returns the list of materials used for the given set of groups
function getMaterialList( groups, materials ) {

	let result = materials;
	if ( ! Array.isArray( materials ) ) {

		result = [];
		groups.forEach( g => {

			result[ g.materialIndex ] = materials;

		} );

	}

	return result;

}

// Utility class for performing CSG operations
class Evaluator {

	get useCDTClipping() {

		return this.triangleSplitter instanceof CDTTriangleSplitter;

	}

	set useCDTClipping( v ) {

		if ( v !== this.useCDTClipping ) {

			this.triangleSplitter = v ? new CDTTriangleSplitter() : new LegacyTriangleSplitter();

		}

	}

	constructor() {

		this.triangleSplitter = new LegacyTriangleSplitter();
		this.geometryBuilders = [];
		this.attributes = [ 'position', 'uv', 'normal' ];
		this.useGroups = true;
		this.consolidateGroups = true;
		this.removeUnusedMaterials = true;
		this.debug = new OperationDebugData();

	}

	getGroupRanges( geometry ) {

		const singleGroup = ! this.useGroups || geometry.groups.length === 0;
		if ( singleGroup ) {

			return [ { start: 0, count: Infinity, materialIndex: 0 } ];

		} else {

			return geometry.groups.map( group => ( { ...group } ) );

		}

	}

	evaluate( a, b, operations, targetBrushes = new Brush() ) {

		let wasArray = true;
		if ( ! Array.isArray( operations ) ) {

			operations = [ operations ];

		}

		if ( ! Array.isArray( targetBrushes ) ) {

			targetBrushes = [ targetBrushes ];
			wasArray = false;

		}

		if ( targetBrushes.length !== operations.length ) {

			throw new Error( 'Evaluator: operations and target array passed as different sizes.' );

		}

		// initialize the geometry fields
		a.prepareGeometry();
		b.prepareGeometry();

		const {
			triangleSplitter,
			geometryBuilders,
			attributes,
			useGroups,
			consolidateGroups,
			removeUnusedMaterials: removeUnusedMaterials$1,
			debug,
		} = this;

		// expand the attribute data array to the necessary size
		while ( geometryBuilders.length < targetBrushes.length ) {

			geometryBuilders.push( new GeometryBuilder() );

		}

		// prepare the attribute data buffer information
		targetBrushes.forEach( ( brush, i ) => {

			geometryBuilders[ i ].initFromGeometry( a.geometry, attributes );
			trimAttributes( brush.geometry, attributes );

		} );

		// run the operation to fill the list of attribute data
		debug.init();
		performOperation( a, b, operations, triangleSplitter, geometryBuilders, { useGroups } );
		debug.complete();

		// get the materials and group ranges
		const aGroups = this.getGroupRanges( a.geometry );
		const aMaterials = getMaterialList( aGroups, a.material );

		const bGroups = this.getGroupRanges( b.geometry );
		const bMaterials = getMaterialList( bGroups, b.material );
		bGroups.forEach( g => g.materialIndex += aMaterials.length );

		// get the full set of groups and materials
		const materials = [ ...aMaterials, ...bMaterials ];
		let groups = [ ...aGroups, ...bGroups ].map( ( group, index ) => ( { ...group, index } ) );

		// adjust the groups
		if ( ! useGroups ) {

			groups = [ { start: 0, count: Infinity, index: 0, materialIndex: 0 } ];

		} else if ( useGroups && consolidateGroups ) {

			// use the same material for any group thats pointing to the same material in different slots
			// so we can merge these groups later
			groups = useCommonMaterials( groups, materials );
			groups.sort( ( a, b ) => a.materialIndex - b.materialIndex );

		}

		// apply groups and attribute data to the geometry
		targetBrushes.forEach( ( brush, i ) => {

			const targetGeometry = brush.geometry;
			geometryBuilders[ i ].buildGeometry( targetGeometry, groups );

			// assign brush A's transform to the result so the geometry is in a stable position
			a.matrixWorld.decompose( brush.position, brush.quaternion, brush.scale );
			brush.updateMatrix();
			brush.matrixWorld.copy( a.matrixWorld );

			if ( useGroups ) {

				brush.material = materials;

				if ( consolidateGroups ) {

					joinGroups( targetGeometry.groups );

				}

				if ( removeUnusedMaterials$1 ) {

					brush.material = removeUnusedMaterials( targetGeometry.groups, materials );

				}

			} else {

				brush.material = materials[ 0 ];

			}

		} );

		return wasArray ? targetBrushes : targetBrushes[ 0 ];

	}

	// TODO: fix
	evaluateHierarchy( root, target = new Brush() ) {

		root.updateMatrixWorld( true );

		const flatTraverse = ( obj, cb ) => {

			const children = obj.children;
			for ( let i = 0, l = children.length; i < l; i ++ ) {

				const child = children[ i ];
				if ( child.isOperationGroup ) {

					flatTraverse( child, cb );

				} else {

					cb( child );

				}

			}

		};


		const traverse = brush => {

			const children = brush.children;
			let didChange = false;
			for ( let i = 0, l = children.length; i < l; i ++ ) {

				const child = children[ i ];
				didChange = traverse( child ) || didChange;

			}

			const isDirty = brush.isDirty();
			if ( isDirty ) {

				brush.markUpdated();

			}

			if ( didChange && ! brush.isOperationGroup ) {

				let result;
				flatTraverse( brush, child => {

					if ( ! result ) {

						result = this.evaluate( brush, child, child.operation );

					} else {

						result = this.evaluate( result, child, child.operation );

					}

				} );

				brush._cachedGeometry = result.geometry;
				brush._cachedMaterials = result.material;
				return true;

			} else {

				return didChange || isDirty;

			}

		};

		traverse( root );

		target.geometry = root._cachedGeometry;
		target.material = root._cachedMaterials;

		return target;

	}

	reset() {

		this.triangleSplitter.reset();

	}

}

class Operation extends Brush {

	constructor( ...args ) {

		super( ...args );

		this.isOperation = true;
		this.operation = ADDITION;

		this._cachedGeometry = new BufferGeometry();
		this._cachedMaterials = null;
		this._previousOperation = null;

	}

	markUpdated() {

		super.markUpdated();
		this._previousOperation = this.operation;

	}

	isDirty() {

		return this.operation !== this._previousOperation || super.isDirty();

	}

	insertBefore( brush ) {

		const parent = this.parent;
		const index = parent.children.indexOf( this );
		parent.children.splice( index, 0, brush );

	}

	insertAfter( brush ) {

		const parent = this.parent;
		const index = parent.children.indexOf( this );
		parent.children.splice( index + 1, 0, brush );

	}

}

class OperationGroup extends Group {

	constructor() {

		super();
		this.isOperationGroup = true;
		this._previousMatrix = new Matrix4();

	}

	markUpdated() {

		this._previousMatrix.copy( this.matrix );

	}

	isDirty() {

		const { matrix, _previousMatrix } = this;
		const el1 = matrix.elements;
		const el2 = _previousMatrix.elements;
		for ( let i = 0; i < 16; i ++ ) {

			if ( el1[ i ] !== el2[ i ] ) {

				return true;

			}

		}

		return false;

	}

}

function addWorldPosition( shader ) {

	if ( /varying\s+vec3\s+wPosition/.test( shader.vertexShader ) ) return;

	shader.vertexShader = `
			varying vec3 wPosition;
			${shader.vertexShader}
		`.replace(
		/#include <displacementmap_vertex>/,
		v =>
			`${v}
				wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
				`,
	);

	shader.fragmentShader = `
		varying vec3 wPosition;
		${shader.fragmentShader}
		`;

	return shader;

}

function csgGridShaderMixin( shader ) {

	shader.uniforms = {
		...shader.uniforms,
		checkerboardColor: { value: new Color( 0x111111 ) }
	};

	addWorldPosition( shader );

	shader.defines = { CSG_GRID: 1 };

	shader.fragmentShader = shader.fragmentShader.replace(
		/#include <common>/,
		v =>
		/* glsl */`
			${v}

			uniform vec3 checkerboardColor;
			float getCheckerboard( vec2 p, float scale ) {

				p /= scale;
				p += vec2( 0.5 );

				vec2 line = mod( p, 2.0 ) - vec2( 1.0 );
				line = abs( line );

				vec2 pWidth = fwidth( line );
				vec2 value = smoothstep( 0.5 - pWidth / 2.0, 0.5 + pWidth / 2.0, line );
				float result = value.x * value.y + ( 1.0 - value.x ) * ( 1.0 - value.y );

				return result;

			}

			float getGrid( vec2 p, float scale, float thickness ) {

				p /= 0.5 * scale;

				vec2 stride = mod( p, 2.0 ) - vec2( 1.0 );
				stride = abs( stride );

				vec2 pWidth = fwidth( p );
				vec2 line = smoothstep( 1.0 - pWidth / 2.0, 1.0 + pWidth / 2.0, stride + thickness * pWidth );

				return max( line.x, line.y );

			}

			vec3 getFaceColor( vec2 p, vec3 color ) {

				float checkLarge = getCheckerboard( p, 1.0 );
				float checkSmall = abs( getCheckerboard( p, 0.1 ) );
				float lines = getGrid( p, 10.0, 1.0 );

				vec3 checkColor = mix(
					vec3( 0.7 ) * color,
					vec3( 1.0 ) * color,
					checkSmall * 0.4 + checkLarge * 0.6
				);

				vec3 gridColor = vec3( 1.0 );

				return mix( checkColor, gridColor, lines );

			}

			float angleBetween( vec3 a, vec3 b ) {

				return acos( abs( dot( a, b ) ) );

			}

			vec3 planeProject( vec3 norm, vec3 other ) {

				float d = dot( norm, other );
				return normalize( other - norm * d );

			}

			vec3 getBlendFactors( vec3 norm ) {

				vec3 xVec = vec3( 1.0, 0.0, 0.0 );
				vec3 yVec = vec3( 0.0, 1.0, 0.0 );
				vec3 zVec = vec3( 0.0, 0.0, 1.0 );

				vec3 projX = planeProject( xVec, norm );
				vec3 projY = planeProject( yVec, norm );
				vec3 projZ = planeProject( zVec, norm );

				float xAngle = max(
					angleBetween( xVec, projY ),
					angleBetween( xVec, projZ )
				);

				float yAngle = max(
					angleBetween( yVec, projX ),
					angleBetween( yVec, projZ )
				);

				float zAngle = max(
					angleBetween( zVec, projX ),
					angleBetween( zVec, projY )
				);

				return vec3( xAngle, yAngle, zAngle ) / ( 0.5 * PI );

			}
		` ).replace(
		/#include <normal_fragment_maps>/,
		v =>
		/* glsl */`${v}
				#if CSG_GRID
				{

					vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );

					float yCont = abs( dot( vec3( 0.0, 1.0, 0.0 ), worldNormal ) );
					float zCont = abs( dot( vec3( 0.0, 0.0, 1.0 ), worldNormal ) );
					float xCont = abs( dot( vec3( 1.0, 0.0, 0.0 ), worldNormal ) );

					vec3 factors = getBlendFactors( worldNormal );
					factors = smoothstep( vec3( 0.475 ), vec3( 0.525 ), vec3( 1.0 ) - factors );

					float weight = factors.x + factors.y + factors.z;
					factors /= weight;

					vec3 color =
						getFaceColor( wPosition.yz, diffuseColor.rgb ) * factors.x +
						getFaceColor( wPosition.xz, diffuseColor.rgb ) * factors.y +
						getFaceColor( wPosition.xy, diffuseColor.rgb ) * factors.z;

					diffuseColor.rgb = color;

				}
				#endif
				`,
	);

	return shader;

}

class GridMaterial extends MeshPhongMaterial {

	get enableGrid() {

		return Boolean( this._enableGrid );

	}

	set enableGrid( v ) {

		if ( this._enableGrid !== v ) {

			this._enableGrid = v;
			this.needsUpdate = true;

		}

	}

	constructor( ...args ) {

		super( ...args );
		this.enableGrid = true;

	}

	onBeforeCompile( shader ) {

		csgGridShaderMixin( shader );
		shader.defines.CSG_GRID = Number( this.enableGrid );

	}

	customProgramCacheKey() {

		return this.enableGrid.toString();

	}

}

function getTriangleDefinitions( ...triangles ) {

	function getVectorDefinition( v ) {

		return /* js */`new THREE.Vector3( ${ v.x }, ${ v.y }, ${ v.z } )`;

	}

	return triangles.map( t => {

		return /* js */`
new THREE.Triangle(
	${ getVectorDefinition( t.a ) },
	${ getVectorDefinition( t.b ) },
	${ getVectorDefinition( t.c ) },
)
		`.trim();

	} );

}

function logTriangleDefinitions( ...triangles ) {

	console.log( getTriangleDefinitions( ...triangles ).join( ',\n' ) );

}

function generateRandomTriangleColors( geometry ) {

	const position = geometry.attributes.position;
	const array = new Float32Array( position.count * 3 );

	const color = new Color();
	for ( let i = 0, l = array.length; i < l; i += 9 ) {

		color.setHSL(
			Math.random(),
			MathUtils.lerp( 0.5, 1.0, Math.random() ),
			MathUtils.lerp( 0.5, 0.75, Math.random() ),
		);

		array[ i + 0 ] = color.r;
		array[ i + 1 ] = color.g;
		array[ i + 2 ] = color.b;

		array[ i + 3 ] = color.r;
		array[ i + 4 ] = color.g;
		array[ i + 5 ] = color.b;

		array[ i + 6 ] = color.r;
		array[ i + 7 ] = color.g;
		array[ i + 8 ] = color.b;

	}

	geometry.setAttribute( 'color', new BufferAttribute( array, 3 ) );

}

class TriangleSetHelper extends Group {

	get color() {

		return this._mesh.material.color;

	}

	get side() {

		return this._mesh.material.side;

	}

	set side( v ) {

		this._mesh.material.side = v;

	}

	constructor( triangles = [] ) {

		super();

		const geometry = new BufferGeometry();
		const lineGeom = new BufferGeometry();
		this._mesh = new Mesh( geometry, new MeshPhongMaterial( {
			flatShading: true,
			transparent: true,
			opacity: 0.25,
			depthWrite: false,
		} ) );
		this._lines = new LineSegments( lineGeom, new LineBasicMaterial() );
		this._mesh.material.color = this._lines.material.color;

		this._lines.frustumCulled = false;
		this._mesh.frustumCulled = false;

		this.add( this._lines, this._mesh );

		this.setTriangles( triangles );

	}

	setTriangles( triangles ) {

		const triPositions = new Float32Array( 3 * 3 * triangles.length );
		const linePositions = new Float32Array( 6 * 3 * triangles.length );
		for ( let i = 0, l = triangles.length; i < l; i ++ ) {

			const i9 = 9 * i;
			const i18 = 18 * i;
			const tri = triangles[ i ];

			tri.a.toArray( triPositions, i9 + 0 );
			tri.b.toArray( triPositions, i9 + 3 );
			tri.c.toArray( triPositions, i9 + 6 );


			tri.a.toArray( linePositions, i18 + 0 );
			tri.b.toArray( linePositions, i18 + 3 );

			tri.b.toArray( linePositions, i18 + 6 );
			tri.c.toArray( linePositions, i18 + 9 );

			tri.c.toArray( linePositions, i18 + 12 );
			tri.a.toArray( linePositions, i18 + 15 );

		}

		this._mesh.geometry.dispose();
		this._mesh.geometry.setAttribute( 'position', new BufferAttribute( triPositions, 3 ) );

		this._lines.geometry.dispose();
		this._lines.geometry.setAttribute( 'position', new BufferAttribute( linePositions, 3 ) );

	}

}

class EdgesHelper extends LineSegments {

	get color() {

		return this.material.color;

	}

	constructor( edges = [] ) {

		super();
		this.frustumCulled = false;
		this.setEdges( edges );

	}

	setEdges( edges ) {

		const { geometry } = this;
		const points = edges.flatMap( e => [ e.start, e.end ] );
		geometry.dispose();
		geometry.deleteAttribute( 'position' );
		geometry.setFromPoints( points );

	}

}

const _matrix = new Matrix4();
class PointsHelper extends InstancedMesh {

	get color() {

		return this.material.color;

	}

	constructor( count = 1000, points = [] ) {

		super( new SphereGeometry( 0.025 ), new MeshBasicMaterial(), count );
		this.frustumCulled = false;
		this.setPoints( points );

	}

	setPoints( points ) {

		for ( let i = 0, l = points.length; i < l; i ++ ) {

			const point = points[ i ];
			_matrix.makeTranslation( point.x, point.y, point.z );
			this.setMatrixAt( i, _matrix );

		}

		this.count = points.length;

	}

}

const vertKeys = [ 'a', 'b', 'c' ];
const _tri1 = new Triangle();
const _tri2 = new Triangle();
const _center = new Vector3();
const _center2 = new Vector3();
const _projected = new Vector3();
const _projected2 = new Vector3();
const _projectedDir = new Vector3();
const _projectedDir2 = new Vector3();
const _edgeDir = new Vector3();
const _edgeDir2 = new Vector3();
const _vec = new Vector3();
const _vec2 = new Vector3();
const _finalPoint = new Vector3();
const _finalPoint2 = new Vector3();
const _plane = new Plane();
const _plane2 = new Plane();
const _centerPoint = new Vector3();
const _ray = new Ray();
const _edge = new Line3();

function getTriangle( geometry, triIndex, target ) {

	const i3 = 3 * triIndex;
	let i0 = i3 + 0;
	let i1 = i3 + 1;
	let i2 = i3 + 2;

	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	if ( indexAttr ) {

		i0 = indexAttr.getX( i0 );
		i1 = indexAttr.getX( i1 );
		i2 = indexAttr.getX( i2 );

	}

	target.a.fromBufferAttribute( posAttr, i0 );
	target.b.fromBufferAttribute( posAttr, i1 );
	target.c.fromBufferAttribute( posAttr, i2 );

	return target;

}

function getOverlapEdge( tri1, e1, tri2, e2, target ) {

	// get the two edges
	const nextE_0 = ( e1 + 1 ) % 3;
	const v0_1 = tri1[ vertKeys[ e1 ] ];
	const v1_1 = tri1[ vertKeys[ nextE_0 ] ];

	const nextE_1 = ( e2 + 1 ) % 3;
	const v0_2 = tri2[ vertKeys[ e2 ] ];
	const v1_2 = tri2[ vertKeys[ nextE_1 ] ];

	// get the ray defined by the edges
	toNormalizedRay( v0_1, v1_1, _ray );

	// get the min and max stride across the rays
	let d0_1 = _vec.subVectors( v0_1, _ray.origin ).dot( _ray.direction );
	let d1_1 = _vec.subVectors( v1_1, _ray.origin ).dot( _ray.direction );
	if ( d0_1 > d1_1 ) [ d0_1, d1_1 ] = [ d1_1, d0_1 ];

	let d0_2 = _vec.subVectors( v0_2, _ray.origin ).dot( _ray.direction );
	let d1_2 = _vec.subVectors( v1_2, _ray.origin ).dot( _ray.direction );
	if ( d0_2 > d1_2 ) [ d0_2, d1_2 ] = [ d1_2, d0_2 ];

	// get the range of overlap
	const final_0 = Math.max( d0_1, d0_2 );
	const final_1 = Math.min( d1_1, d1_2 );
	_ray.at( final_0, target.start );
	_ray.at( final_1, target.end );

}


class HalfEdgeHelper extends EdgesHelper {

	constructor( geometry = null, halfEdges = null ) {

		super();
		this.straightEdges = false;
		this.displayDisconnectedEdges = false;

		if ( geometry && halfEdges ) {

			this.setHalfEdges( geometry, halfEdges );

		}

	}

	setHalfEdges( geometry, halfEdges ) {

		const { straightEdges, displayDisconnectedEdges } = this;
		const edges = [];
		const offset = geometry.drawRange.start;
		let triCount = getTriCount( geometry );
		if ( geometry.drawRange.count !== Infinity ) {

			triCount = ~ ~ ( geometry.drawRange.count / 3 );

		}

		if ( displayDisconnectedEdges ) {

			if ( halfEdges.unmatchedDisjointEdges ) {

				halfEdges
					.unmatchedDisjointEdges
					.forEach( ( { forward, reverse, ray } ) => {

						[ ...forward, ...reverse ]
							.forEach( ( { start, end } ) => {

								const edge = new Line3();
								ray.at( start, edge.start );
								ray.at( end, edge.end );
								edges.push( edge );

							} );

					} );

			} else {

				for ( let triIndex = offset; triIndex < triCount; triIndex ++ ) {

					getTriangle( geometry, triIndex, _tri1 );
					for ( let e = 0; e < 3; e ++ ) {

						const otherTriIndex = halfEdges.getSiblingTriangleIndex( triIndex, e );
						if ( otherTriIndex === - 1 ) {

							const nextE = ( e + 1 ) % 3;
							const v0 = _tri1[ vertKeys[ e ] ];
							const v1 = _tri1[ vertKeys[ nextE ] ];
							const edge = new Line3();
							edge.start.copy( v0 );
							edge.end.copy( v1 );
							edges.push( edge );

						}

					}

				}

			}

		} else {

			for ( let triIndex = offset; triIndex < triCount; triIndex ++ ) {

				getTriangle( geometry, triIndex, _tri1 );
				for ( let e = 0; e < 3; e ++ ) {

					const otherTriIndex = halfEdges.getSiblingTriangleIndex( triIndex, e );
					if ( otherTriIndex === - 1 ) {

						continue;

					}

					// get other triangle
					getTriangle( geometry, otherTriIndex, _tri2 );

					// get edge centers
					const nextE = ( e + 1 ) % 3;
					const v0 = _tri1[ vertKeys[ e ] ];
					const v1 = _tri1[ vertKeys[ nextE ] ];
					_centerPoint.lerpVectors( v0, v1, 0.5 );
					addConnectionEdge( _tri1, _tri2, _centerPoint );

				}

				if ( halfEdges.disjointConnections ) {

					for ( let e = 0; e < 3; e ++ ) {

						const disjointTriIndices = halfEdges.getDisjointSiblingTriangleIndices( triIndex, e );
						const disjointEdgeIndices = halfEdges.getDisjointSiblingEdgeIndices( triIndex, e );

						for ( let i = 0; i < disjointTriIndices.length; i ++ ) {

							const ti = disjointTriIndices[ i ];
							const ei = disjointEdgeIndices[ i ];

							// get other triangle
							getTriangle( geometry, ti, _tri2 );

							getOverlapEdge( _tri1, e, _tri2, ei, _edge );

							_centerPoint.lerpVectors( _edge.start, _edge.end, 0.5 );
							addConnectionEdge( _tri1, _tri2, _centerPoint );

						}

					}

				}

			}

		}

		super.setEdges( edges );

		function addConnectionEdge( tri1, tri2, centerPoint ) {

			tri1.getMidpoint( _center );
			tri2.getMidpoint( _center2 );

			tri1.getPlane( _plane );
			tri2.getPlane( _plane2 );

			const edge = new Line3();
			edge.start.copy( _center );

			if ( straightEdges ) {

				// get the projected centers
				_plane.projectPoint( _center2, _projected );
				_plane2.projectPoint( _center, _projected2 );

				// get the directions so we can flip them if needed
				_projectedDir.subVectors( _projected, _center );
				_projectedDir2.subVectors( _projected2, _center2 );

				// get the directions so we can flip them if needed
				_edgeDir.subVectors( centerPoint, _center );
				_edgeDir2.subVectors( centerPoint, _center2 );

				if ( _projectedDir.dot( _edgeDir ) < 0 ) {

					_projectedDir.multiplyScalar( - 1 );

				}

				if ( _projectedDir2.dot( _edgeDir2 ) < 0 ) {

					_projectedDir2.multiplyScalar( - 1 );

				}

				// find the new points after inversion
				_vec.addVectors( _center, _projectedDir );
				_vec2.addVectors( _center2, _projectedDir2 );

				// project the points onto the triangle edge. This would be better
				// if we clipped instead of chose the closest point
				tri1.closestPointToPoint( _vec, _finalPoint );
				tri2.closestPointToPoint( _vec2, _finalPoint2 );

				edge.end.lerpVectors( _finalPoint, _finalPoint2, 0.5 );

			} else {

				edge.end.copy( centerPoint );

			}

			edges.push( edge );

		}

	}

}

// https://stackoverflow.com/questions/1406029/how-to-calculate-the-volume-of-a-3d-mesh-object-the-surface-of-which-is-made-up
const _tri = new Triangle();
const _normal = new Vector3();
const _relPoint = new Vector3();
function computeMeshVolume( mesh ) {

	// grab the matrix and the geometry
	let geometry;
	let matrix;
	if ( mesh.isBufferGeometry ) {

		geometry = mesh;
		matrix = null;

	} else {

		geometry = mesh.geometry;
		matrix = Math.abs( mesh.matrixWorld.determinant() - 1.0 ) < 1e-15 ? null : mesh.matrixWorld;

	}

	// determine the number of relevant draw range elements to use
	const index = geometry.index;
	const pos = geometry.attributes.position;
	const drawRange = geometry.drawRange;
	const triCount = Math.min( getTriCount( geometry ), drawRange.count / 3 );

	// get a point relative to the position of the geometry to avoid floating point error
	_tri.setFromAttributeAndIndices( pos, 0, 1, 2 );
	applyMatrix4ToTri( _tri, matrix );
	_tri.getNormal( _normal );
	_tri.getMidpoint( _relPoint ).add( _normal );

	// iterate over all triangles
	let volume = 0;
	const startIndex = drawRange.start / 3;
	for ( let i = startIndex, l = startIndex + triCount; i < l; i ++ ) {

		let i0 = 3 * i + 0;
		let i1 = 3 * i + 1;
		let i2 = 3 * i + 2;
		if ( index ) {

			i0 = index.getX( i0 );
			i1 = index.getX( i1 );
			i2 = index.getX( i2 );

		}

		// get the triangle
		_tri.setFromAttributeAndIndices( pos, i0, i1, i2 );
		applyMatrix4ToTri( _tri, matrix );
		subVectorFromTri( _tri, _relPoint );

		// add the signed volume
		volume += signedVolumeOfTriangle( _tri.a, _tri.b, _tri.c );

	}

	return Math.abs( volume );

}

function signedVolumeOfTriangle( p1, p2, p3 ) {

	const v321 = p3.x * p2.y * p1.z;
	const v231 = p2.x * p3.y * p1.z;
	const v312 = p3.x * p1.y * p2.z;
	const v132 = p1.x * p3.y * p2.z;
	const v213 = p2.x * p1.y * p3.z;
	const v123 = p1.x * p2.y * p3.z;
	return ( 1 / 6 ) * ( - v321 + v231 + v312 - v132 - v213 + v123 );

}

function subVectorFromTri( tri, pos ) {

	tri.a.sub( pos );
	tri.b.sub( pos );
	tri.c.sub( pos );

}

function applyMatrix4ToTri( tri, mat = null ) {

	if ( mat !== null ) {

		tri.a.applyMatrix4( mat );
		tri.b.applyMatrix4( mat );
		tri.c.applyMatrix4( mat );

	}

}

export { ADDITION, Brush, CDTTriangleSplitter, DIFFERENCE, EdgesHelper, Evaluator, GridMaterial, HOLLOW_INTERSECTION, HOLLOW_SUBTRACTION, HalfEdgeHelper, HalfEdgeMap, INTERSECTION, LegacyTriangleSplitter, Operation, OperationGroup, PointsHelper, REVERSE_SUBTRACTION, SUBTRACTION, TriangleSetHelper, computeMeshVolume, generateRandomTriangleColors, getTriangleDefinitions, logTriangleDefinitions };
//# sourceMappingURL=index.module.js.map
