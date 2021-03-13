'use strict'

/*==============================================================================
 * Object pool to reuse different kinds of objects. This is to avoid creating
 * lots of temporary objects, which would then trigger garbage collector.
 */
function ObjectPool(create_func, cleanup_func = null) {
   let free_first = null;
   let used_first = null;
   let used_last  = null;

   this.get = function () {
      let obj = null;
      if (free_first) {
         obj = free_first;
         free_first = obj.next_object_in_pool;
      } else {
         obj = create_func();
      }
      if (!used_last) {
         used_last = obj;
      }
      obj.next_object_in_pool = used_first;
      used_first = obj;
      return obj;
   };
   this.releaseAll = function () {
      if (cleanup_func) {
         for (let obj = used_first; obj; obj = obj.next_object_in_pool) {
            cleanup_func(obj);
         }
      }
      if (used_last) {
         used_last.next_object_in_pool = free_first;
         free_first = used_first;
      }
      used_first = null;
      used_last  = null;
   };
}

let BoundingBox = {
   pool: new ObjectPool(() => ({
      left:   0,
      right:  0,
      bottom: 0,
      top:    0
   })),
   copy: function (dst, src) {
      dst.left   = src.left;
      dst.right  = src.right;
      dst.bottom = src.bottom;
      dst.top    = src.top;
   },
   bboxFromPoint: function (point) {
      let out = BoundingBox.pool.get();
      out.left   = point[0];
      out.right  = point[0];
      out.bottom = point[1];
      out.top    = point[1];
      return out;
   }
};

/*==============================================================================
 * 2-element vectors to represent points and vectors in 2D space.
 *
 * Returned objects are retrieved from the Vector2 pool, therefore they are
 * temporary and will vanish when the pool releases them. If they are needed
 * for longer, they need to be copied to a permanent object (not from pool).
 */
let Vector2 = {
   pool: new ObjectPool(() => [0,0]),

   copy: function (dst, src) {
      dst[0] = src[0];
      dst[1] = src[1];
   },

   construct: function (x, y) {
      let out = Vector2.pool.get();
      out[0] = x;
      out[1] = y;
      return out;
   },
   add: function (v1, v2) {
      let out = Vector2.pool.get();
      out[0] = v1[0] + v2[0];
      out[1] = v1[1] + v2[1];
      return out;
   },
   subtract: function (v1, v2) {
      let out = Vector2.pool.get();
      out[0] = v1[0] - v2[0];
      out[1] = v1[1] - v2[1];
      return out;
   },
   scale: function (scalar, v) {
      let out = Vector2.pool.get();
      out[0] = scalar * v[0];
      out[1] = scalar * v[1];
      return out;
   },
   transform: function (matrix, v) {
      let out = Vector2.pool.get();
      out[0] = matrix[0] * v[0] + matrix[3] * v[1] + matrix[6];
      out[1] = matrix[1] * v[0] + matrix[4] * v[1] + matrix[7];
      return out;
   },
   normalize: function (v) {
      let s = Vector2.length(v);
      if (s > 0) {
         s = 1.0 / s;
      }
      return Vector2.scale(s, v);
   },

   length: function (v) {
      return Math.sqrt(v[0]*v[0] + v[1]*v[1]);
   },
   dot: function (v1, v2) {
      return (v1[0]*v2[0] + v1[1]*v2[1]);
   },

   // Calculate intersection point of two lines.
   // Return null when the lines don't intersect.
   lineIntersection: function (line1, line2) {
      let dx1 = line1[2] - line1[0];
      let dy1 = line1[3] - line1[1];
      let dx2 = line2[2] - line2[0];
      let dy2 = line2[3] - line2[1];
      let r = (dx1 * dy2) - (dx2 * dy1);
      if (r != 0) {
         let a = (dx2 * (line1[1] - line2[1]) - dy2 * (line1[0] - line2[0])) / r;
         let b = (dx1 * (line1[1] - line2[1]) - dy1 * (line1[0] - line2[0])) / r;
         // This would be for line segments:
         // if ((a >= 0) && (a <= 1) && (b >= 0) && (b <= 1)) {
         let out = Vector2.pool.get();
         out[0] = line1[0] + (dx1 * a);
         out[1] = line1[1] + (dy1 * a);
         return out;
      }
      return null;
   },
   nearestPointAtLine: function (line, point) {
      let dx = line[2] - line[0];
      let dy = line[3] - line[1];
      let len_squared = dx * dx + dy * dy;
      let dot = (((point[0] - line[0]) * dx) + ((point[1] - line[1]) * dy)) / len_squared;
      let out = Vector2.pool.get();
      out[0] = line[0] + (dot * dx);
      out[1] = line[1] + (dot * dy);
      return out;
   }
};

/*==============================================================================
 * 4-element vectors to represent lines and line segments in 2D space.
 * Contain coordinates of two points [x1, y1, x2, y2].
 *
 * Returned objects are retrieved from the Vector4 pool, therefore they are
 * temporary and will vanish when the pool releases them. If they are needed
 * for longer, they need to be copied to a permanent object (not from pool).
 */
let Vector4 = {
   pool: new ObjectPool(() => [0,0,0,0]),

   copy: function (dst, src) {
      dst[0] = src[0];
      dst[1] = src[1];
      dst[2] = src[2];
      dst[3] = src[3];
   },

   lineFromPointAndAngle: function (point, angle) {
      let out = Vector4.pool.get();
      out[0] = point[0];
      out[1] = point[1];
      out[2] = point[0] + Math.cos(angle);
      out[3] = point[1] + Math.sin(angle);
      return out;
   },
   lineFromTwoPoints: function (point1, point2) {
      let out = Vector4.pool.get();
      out[0] = point1[0];
      out[1] = point1[1];
      out[2] = point2[0];
      out[3] = point2[1];
      return out;
   },
   linePerpendicularToAngleOutsideOfBbox: function (angle, bbox) {
      let out = Vector4.pool.get();
      if (angle < -Math.PI/2) {
         out[0] = bbox.left;
         out[1] = bbox.bottom;
      } else if (angle < 0) {
         out[0] = bbox.right;
         out[1] = bbox.bottom;
      } else if (angle < Math.PI/2) {
         out[0] = bbox.right;
         out[1] = bbox.top;
      } else {
         out[0] = bbox.left;
         out[1] = bbox.top;
      }
      out[2] = out[0] + Math.cos(angle + Math.PI/2);
      out[3] = out[1] + Math.sin(angle + Math.PI/2);
      return out;
   }
}

/*==============================================================================
 * 3x3 matrices for 2D transformations. Column-major order is used.
 *
 * Returned objects are retrieved from the Matrix3 pool, therefore they are
 * temporary and will vanish when the pool releases them. If they are needed
 * for longer, they need to be copied to a permanent object (not from pool).
 */
let Matrix3 = {
   pool: new ObjectPool(() => [0,0,0,0,0,0,0,0,0]),

   copy: function (dst, src) {
      // 1st column.
      dst[0] = src[0];
      dst[1] = src[1];
      dst[2] = src[2];
      // 2nd column.
      dst[3] = src[3];
      dst[4] = src[4];
      dst[5] = src[5];
      // 3rd column.
      dst[6] = src[6];
      dst[7] = src[7];
      dst[8] = src[8];
   },

   identity: function () {
      let out = Matrix3.pool.get();
      // 1st column.
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      // 2nd column.
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      // 3rd column.
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
   },
   rotation: function (angle) {
      // Counterclockwise rotation.
      let cos_a = Math.cos(angle);
      let sin_a = Math.sin(angle);
      let out = Matrix3.pool.get();
      // 1st column.
      out[0] = +cos_a;
      out[1] = +sin_a;
      out[2] = 0;
      // 2nd column.
      out[3] = -sin_a;
      out[4] = +cos_a;
      out[5] = 0;
      // 3rd column.
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
   },
   scale: function (v) {
      let out = Matrix3.pool.get();
      // 1st column.
      out[0] = v[0];
      out[1] = 0;
      out[2] = 0;
      // 2nd column.
      out[3] = 0;
      out[4] = v[1];
      out[5] = 0;
      // 3rd column.
      out[6] = 0;
      out[7] = 0;
      out[8] = 1;
      return out;
   },
   translation: function (v) {
      let out = Matrix3.pool.get();
      // 1st column.
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      // 2nd column.
      out[3] = 0;
      out[4] = 1;
      out[5] = 0;
      // 3rd column.
      out[6] = v[0];
      out[7] = v[1];
      out[8] = 1;
      return out;
   },
   multiply: function (m1, m2) {
      let out = Matrix3.pool.get();
      // 1st column.
      out[0] = m1[0]*m2[0] + m1[3]*m2[1] + m1[6]*m2[2];
      out[1] = m1[1]*m2[0] + m1[4]*m2[1] + m1[7]*m2[2];
      out[2] = m1[2]*m2[0] + m1[5]*m2[1] + m1[8]*m2[2];
      // 2nd column.
      out[3] = m1[0]*m2[3] + m1[3]*m2[4] + m1[6]*m2[5];
      out[4] = m1[1]*m2[3] + m1[4]*m2[4] + m1[7]*m2[5];
      out[5] = m1[2]*m2[3] + m1[5]*m2[4] + m1[8]*m2[5];
      // 3rd column.
      out[6] = m1[0]*m2[6] + m1[3]*m2[7] + m1[6]*m2[8];
      out[7] = m1[1]*m2[6] + m1[4]*m2[7] + m1[7]*m2[8];
      out[8] = m1[2]*m2[6] + m1[5]*m2[7] + m1[8]*m2[8];
      return out;
   },
   inverse: function (m) {
      let out = Matrix3.pool.get();
      // Transpose the original matrix, and calculate the determinants
      // of each of the minor 2x2 matrices of the transposed matrix.
      // 1st column.
      out[0] = +(m[4]*m[8] - m[7]*m[5]);
      out[1] = -(m[1]*m[8] - m[7]*m[2]);
      out[2] = +(m[1]*m[5] - m[4]*m[2]);
      // 2nd column.
      out[3] = -(m[3]*m[8] - m[6]*m[5]);
      out[4] = +(m[0]*m[8] - m[6]*m[2]);
      out[5] = -(m[0]*m[5] - m[3]*m[2]);
      // 3rd column.
      out[6] = +(m[3]*m[7] - m[6]*m[4]);
      out[7] = -(m[0]*m[7] - m[6]*m[1]);
      out[8] = +(m[0]*m[4] - m[3]*m[1]);
      // Calculate the determinant of the original matrix.
      let det = m[0]*out[0] + m[1]*out[3] + m[2]*out[6];
      let idet = 1.0 / det;
      // Calculate the inversed matrix.
      for (let i = 0; i < 9; i++) {
         out[i] *= idet;
      }
      return out;
   }
};

/*==============================================================================
 * Angles are in range (-PI, PI], and their coordinate system interpretation
 * is shown below. This corresponds to the results of atan2(y,x).
 *
 *   3PI/4   PI/2   PI/4
 *           y ^
 *             |
 *      PI ----+---> 0
 *             |   x
 *             |
 *  -3PI/4  -PI/2  -PI/4
 */

function angleFromVector(vec) {
   return Math.atan2(vec[1], vec[0]);
}

function angleDifference(angle1, angle2) {
   let angle = angle1 - angle2;
   if (angle <= -Math.PI) angle += 2*Math.PI;
   if (angle >   Math.PI) angle -= 2*Math.PI;
   return angle;
}

function angleAverage(angle1, angle2) {
   let angle;
   if (Math.abs(angle1 - angle2) < Math.PI) {
      angle = (angle1 + angle2) / 2;
   } else {
      angle = (angle1 + angle2 + 2*Math.PI) / 2;
      if (angle > Math.PI) {
         angle -= 2*Math.PI;
      }
   }
   return angle;
}

function distanceBetweenTwoPoints(point1, point2) {
   return Vector2.length(Vector2.subtract(point1, point2));
}

function linearInterpolation(value1, value2, delta) {
   return (value1 + (value2 - value1) * delta);
}

/*==============================================================================
 * Line segment vs. circle collision detection.
 */
function lineSegmentCircleCollide(line_segment, circle_center, circle_radius) {
   // Check whether either end of the line segment is within the circle.
   let dx1 = circle_center[0] - line_segment[0];
   let dy1 = circle_center[1] - line_segment[1];
   let dx2 = circle_center[0] - line_segment[2];
   let dy2 = circle_center[1] - line_segment[3];
   let r_squared = circle_radius * circle_radius;
   if ((dx1 * dx1 + dy1 * dy1) < r_squared || (dx2 * dx2 + dy2 * dy2) < r_squared) {
      return true;
   }
   // Calculate the nearest point of the line to the circle.
   let nearest = Vector2.nearestPointAtLine(line_segment, circle_center);
   // Check whether the nearest point is within the line segment.
   let min_x = Math.min(line_segment[0], line_segment[2]);
   let max_x = Math.max(line_segment[0], line_segment[2]);
   let min_y = Math.min(line_segment[1], line_segment[3]);
   let max_y = Math.max(line_segment[1], line_segment[3]);
   if ((nearest[0] < min_x) || (nearest[0] > max_x) || (nearest[1] < min_y) || (nearest[1] > max_y)) {
      return false;
   }
   // Check whether the nearest point is within the circle.
   let dx = circle_center[0] - nearest[0];
   let dy = circle_center[1] - nearest[1];
   return ((dx * dx + dy * dy) < r_squared);
}
