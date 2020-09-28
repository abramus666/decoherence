
/*==============================================================================
 * 3x3 matrices are sufficient for 2D transformations. Column-major order
 * is used, therefore rows in the matrices below are actually columns.
 */
let Matrix3 = {
   rotation: function (angle) {
      let c = Math.cos(angle);
      let s = Math.sin(angle);
      return [
         c,-s, 0,
         s, c, 0,
         0, 0, 1
      ];
   },
   scale: function (x, y) {
      return [
         x, 0, 0,
         0, y, 0,
         0, 0, 1
      ];
   },
   translation: function (x, y) {
      return [
         1, 0, 0,
         0, 1, 0,
         x, y, 1
      ];
   },
   multiply: function (m1, m2) {
      return [
         m1[0]*m2[0]+m1[3]*m2[1]+m1[6]*m2[2], m1[1]*m2[0]+m1[4]*m2[1]+m1[7]*m2[2], m1[2]*m2[0]+m1[5]*m2[1]+m1[8]*m2[2],
         m1[0]*m2[3]+m1[3]*m2[4]+m1[6]*m2[5], m1[1]*m2[3]+m1[4]*m2[4]+m1[7]*m2[5], m1[2]*m2[3]+m1[5]*m2[4]+m1[8]*m2[5],
         m1[0]*m2[6]+m1[3]*m2[7]+m1[6]*m2[8], m1[1]*m2[6]+m1[4]*m2[7]+m1[7]*m2[8], m1[2]*m2[6]+m1[5]*m2[7]+m1[8]*m2[8]
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

function angleDifference(angle1, angle2) {
   let angle = Math.abs(angle1 - angle2);
   if (angle > Math.PI) {
      angle = 2*Math.PI - angle;
   }
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
   const maxratio = 100000.0;
   let point = null;
   let dx1 = line1[2] - line1[0];
   let dy1 = line1[3] - line1[1];
   let dx2 = line2[2] - line2[0];
   let dy2 = line2[3] - line2[1];
   let a1 = dy1 / dx1;
   let a2 = dy2 / dx2;
   let b1 = line1[1] - line1[0] * a1;
   let b2 = line2[1] - line2[0] * a2;
   // Check whether any of lines is vertical (or close to vertical).
   // These cases need to be handled differently to avoid large calculation errors. 
   let vert1 = Math.abs(dy1) > Math.abs(dx1) * maxratio;
   let vert2 = Math.abs(dy2) > Math.abs(dx2) * maxratio;
   if (!vert1 && !vert2) {
      if (a1 != a2) {
         let x = (b2 - b1) / (a1 - a2);
         let y = x * a1 + b1;
         point = [x, y];
      }
   } else if (!vert1) {
      let x = line2[0];
      let y = x * a1 + b1;
      point = [x, y];
   } else if (!vert2) {
      let x = line1[0];
      let y = x * a2 + b2;
      point = [x, y];
   }
   return point;
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
