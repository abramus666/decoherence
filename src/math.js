'use strict'

let Vector2 = {
   length: function (v) {
      return Math.sqrt(v[0]*v[0] + v[1]*v[1]);
   },
   dot: function (v1, v2) {
      return (v1[0]*v2[0] + v1[1]*v2[1]);
   },
   add: function (v1, v2) {
      return [
         v1[0] + v2[0],
         v1[1] + v2[1]
      ];
   },
   subtract: function (v1, v2) {
      return [
         v1[0] - v2[0],
         v1[1] - v2[1]
      ];
   },
   scale: function (s, v) {
      return [
         s*v[0],
         s*v[1]
      ];
   },
   transform: function (m, v) {
      return [
         m[0]*v[0] + m[3]*v[1] + m[6],
         m[1]*v[0] + m[4]*v[1] + m[7],
      ];
   },
   normalize: function (v) {
      let len = Vector2.length(v);
      if (len > 0) {
         return Vector2.scale(1.0 / len, v);
      } else {
         return v;
      }
   }
};

/*==============================================================================
 * 3x3 matrices are sufficient for 2D transformations. Column-major order
 * is used, therefore rows in the matrices below are actually columns.
 */
let Matrix3 = {
   identity: function () {
      return [
         1, 0, 0,
         0, 1, 0,
         0, 0, 1
      ];
   },
   rotation: function (angle) {
      // Counterclockwise rotation.
      let c = Math.cos(angle);
      let s = Math.sin(angle);
      return [
         c, s, 0,
         -s, c, 0,
         0, 0, 1
      ];
   },
   scale: function (v) {
      return [
         v[0], 0, 0,
         0, v[1], 0,
         0, 0, 1
      ];
   },
   translation: function (v) {
      return [
         1, 0, 0,
         0, 1, 0,
         v[0], v[1], 1
      ];
   },
   multiply: function (m1, m2) {
      return [
         m1[0]*m2[0]+m1[3]*m2[1]+m1[6]*m2[2], m1[1]*m2[0]+m1[4]*m2[1]+m1[7]*m2[2], m1[2]*m2[0]+m1[5]*m2[1]+m1[8]*m2[2],
         m1[0]*m2[3]+m1[3]*m2[4]+m1[6]*m2[5], m1[1]*m2[3]+m1[4]*m2[4]+m1[7]*m2[5], m1[2]*m2[3]+m1[5]*m2[4]+m1[8]*m2[5],
         m1[0]*m2[6]+m1[3]*m2[7]+m1[6]*m2[8], m1[1]*m2[6]+m1[4]*m2[7]+m1[7]*m2[8], m1[2]*m2[6]+m1[5]*m2[7]+m1[8]*m2[8]
      ];
   },
   inverse: function (m) {
      // Transpose the original matrix, and calculate the determinants
      // of each of the minor 2x2 matrices of the transposed matrix.
      let adj = [
         +(m[4]*m[8]-m[7]*m[5]), -(m[1]*m[8]-m[7]*m[2]), +(m[1]*m[5]-m[4]*m[2]),
         -(m[3]*m[8]-m[6]*m[5]), +(m[0]*m[8]-m[6]*m[2]), -(m[0]*m[5]-m[3]*m[2]),
         +(m[3]*m[7]-m[6]*m[4]), -(m[0]*m[7]-m[6]*m[1]), +(m[0]*m[4]-m[3]*m[1])
      ];
      // Calculate the determinant of the original matrix.
      let det = m[0]*adj[0] + m[1]*adj[3] + m[2]*adj[6];
      let idet = 1.0 / det;
      return [
         idet*adj[0], idet*adj[1], idet*adj[2],
         idet*adj[3], idet*adj[4], idet*adj[5],
         idet*adj[6], idet*adj[7], idet*adj[8]
      ];
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
   let dx = point1[0] - point2[0];
   let dy = point1[1] - point2[1];
   return Math.sqrt(dx*dx + dy*dy);
}

/*==============================================================================
 * Lines are 4-element arrays with coordinates of two points [x1, y1, x2, y2].
 */

/* Calculate intersection point of two lines. */
function lineIntersection(line1, line2) {
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
      return [
         line1[0] + (dx1 * a),
         line1[1] + (dy1 * a)
      ];
   }
   return null;
}

function lineFromPointAndAngle(point, angle) {
   return [
      point[0],
      point[1],
      point[0] + Math.cos(angle),
      point[1] + Math.sin(angle)
   ];
}

function lineFromTwoPoints(point1, point2) {
   return [point1[0], point1[1], point2[0], point2[1]];
}

function linePerpendicularToAngleOutsideOfBbox(angle, bbox) {
   let point;
   if (angle < -Math.PI/2) {
      point = [bbox.left,  bbox.bottom];
   } else if (angle < 0) {
      point = [bbox.right, bbox.bottom];
   } else if (angle < Math.PI/2) {
      point = [bbox.right, bbox.top];
   } else {
      point = [bbox.left,  bbox.top];
   }
   return lineFromPointAndAngle(point, angle + Math.PI/2);
}

function nearestPointAtLine(line, point) {
   let dx = line[2] - line[0];
   let dy = line[3] - line[1];
   let len_squared = dx * dx + dy * dy;
   let dot = (((point[0] - line[0]) * dx) + ((point[1] - line[1]) * dy)) / len_squared;
   let x = line[0] + (dot * dx);
   let y = line[1] + (dot * dy);
   return [x, y];
}

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
   let nearest = nearestPointAtLine(line_segment, circle_center);
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
