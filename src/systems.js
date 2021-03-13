'use strict'

function ResourceLoader(gl) {
   let resources = {};
   let num_pending = 0;

   function loadImage(url, create_func) {
      if (!(url in resources)) {
         num_pending += 1;
         let image = new Image();
         image.onload = function () {
            resources[url] = create_func(image);
            num_pending -= 1;
         };
         image.src = url;
      }
   }

   function loadJson(url, create_func) {
      if (!(url in resources)) {
         num_pending += 1;
         let request = new XMLHttpRequest();
         request.onload = function () {
            resources[url] = create_func(request.response);
            num_pending -= 1;
         };
         request.open('GET', url);
         request.responseType = 'json';
         request.send();
      }
   }

   this.loadTexture = function (url) {
      loadImage(url, image => new TextureFromImage(gl, image));
   };
   this.loadTexture_sRGB = function (url) {
      loadImage(url, image => new TextureFromImage_sRGB(gl, image));
   };
   this.loadModel = function (url) {
      loadJson(url, json => new Model(gl, json));
   };
   this.loadMap = function (url) {
      loadJson(url, json => new Map(gl, json));
   };
   this.get = function (url) {
      return resources[url];
   };
   this.completed = function () {
      return (num_pending == 0);
   };
}

/*==============================================================================
 * Permanent array to be used instead of the standard one.
 * Capacity is doubled each time there is no room for a new element.
 * Capacity is never decreased.
 */
function PermanentArray() {
   this.array = new Array(32); // Initial capacity.
   this.count = 0;

   this.insertAt = function (index, obj) {
      index = Math.min(Math.max(index, 0), this.count);
      // Double array capacity when there is no room for the new element.
      if (this.array.length == this.count) {
         this.array.length *= 2;
      }
      // Shift array elements to make room for the new element.
      for (let i = this.count; i > index; i--) {
         this.array[i] = this.array[i-1];
      }
      this.array[index] = obj;
      this.count += 1;
   };
   this.removeAt = function (index) {
      if (index < 0 || index >= this.count) {
         return undefined;
      }
      let obj = this.array[index];
      // Shift array elements to delete gap after the removed element.
      for (let i = index; i < this.count-1; i++) {
         this.array[i] = this.array[i+1];
      }
      this.array[this.count-1] = undefined;
      this.count -= 1;
      return obj;
   };
   this.push = function (obj) {
      this.insertAt(this.count, obj);
   };
   this.pop = function () {
      return this.removeAt(this.count-1);
   };
   this.clear = function () {
      for (let i = 0; i < this.count; i++) {
         this.array[i] = undefined;
      }
      this.count = 0;
   };
}

/*==============================================================================
 * Priority queue implemented as a sorted permanent array.
 */
function PermanentPriorityQueue() {
   let queue = new PermanentArray();

   this.push = function (node, priority) {
      node.priority_in_queue = priority;
      // The path nodes array is sorted in descending order.
      // Use binary search to find the place to put the new node.
      let start = 0;
      let end = queue.count;
      while (start < end) {
         let i = (start + end) >> 1;
         if (node.priority_in_queue > queue.array[i].priority_in_queue) {
            end = i;
         } else {
            start = i+1;
         }
      }
      queue.insertAt(end, node);
   };
   this.pop = function () {
      return queue.pop();
   };
   this.empty = function () {
      return (queue.count == 0);
   };
}

//==============================================================================

function interpolateBetweenCircles(frame1, frame2, delta) {
   let circle = Circle.pool.get();
   circle.center_x = linearInterpolation(frame1.center_x, frame2.center_x, delta);
   circle.center_y = linearInterpolation(frame1.center_y, frame2.center_y, delta);
   circle.radius   = linearInterpolation(frame1.radius,   frame2.radius,   delta);
   return circle;
}
function interpolateBetweenEdges(frame1, frame2, delta) {
   let edge = Vector4.pool.get();
   edge[0] = linearInterpolation(frame1[0], frame2[0], delta);
   edge[1] = linearInterpolation(frame1[1], frame2[1], delta);
   edge[2] = linearInterpolation(frame1[2], frame2[2], delta);
   edge[3] = linearInterpolation(frame1[3], frame2[3], delta);
   return edge;
}
function interpolateBetweenPoints(frame1, frame2, delta) {
   let point = Vector2.pool.get();
   point[0] = linearInterpolation(frame1[0], frame2[0], delta);
   point[1] = linearInterpolation(frame1[1], frame2[1], delta);
   return point;
}

function Model(gl, json) {
   let entities = json['entities'];
   let vertices = json['vertices'];
   this.model_renderer = new ModelRenderer(gl, json);
   this.entity_interpolate_func = {};
   this.entities = {};
   // Save the appropriate interpolation function for the given entity type.
   // Determine entity coordinates for all animation frames.
   for (let entity of entities) {
      let name = entity['name'];
      let kind = entity['kind'];
      let val = entity['value'];
      if (kind == 'circle') {
         this.entity_interpolate_func[name] = interpolateBetweenCircles;
         this.entities[name] = {};
          for (let anim_name in vertices) {
            this.entities[name][anim_name] = vertices[anim_name].map(function (frame) {
               return {
                  center_x: frame[val[0]][0],
                  center_y: frame[val[0]][1],
                  radius: distanceBetweenTwoPoints(frame[val[0]], frame[val[1]])
               };
            });
         }
      }
      if (kind == 'edge') {
         this.entity_interpolate_func[name] = interpolateBetweenEdges;
         this.entities[name] = {};
         for (let anim_name in vertices) {
            this.entities[name][anim_name] = vertices[anim_name].map(function (frame) {
               return [
                  frame[val[0]][0],
                  frame[val[0]][1],
                  frame[val[1]][0],
                  frame[val[1]][1]
               ];
            });
         }
      }
      if (kind == 'point') {
         this.entity_interpolate_func[name] = interpolateBetweenPoints;
         this.entities[name] = {};
         for (let anim_name in vertices) {
            this.entities[name][anim_name] = vertices[anim_name].map(function (frame) {
               return [
                  frame[val][0],
                  frame[val][1]
               ];
            });
         }
      }
   }
}

Model.prototype.draw = function (shader, anim_name, anim_pos) {
   this.model_renderer.draw(shader, anim_name, anim_pos);
}

Model.prototype.get = function (entity_name, anim_name, anim_pos) {
   let frames = this.entities[entity_name][anim_name];
   // Select two frames to interpolate between.
   let n = Math.min(Math.max(anim_pos, 0.0), 1.0) * (frames.length-1);
   let i1 = Math.trunc(n);
   let i2 = (i1 + 1) % frames.length;
   let delta = n - i1;
   if (delta == 0) {
      // Exact match, interpolation not needed.
      return frames[i1];
   } else {
      // Perform linear interpolation based on animation position.
      return this.entity_interpolate_func[entity_name](frames[i1], frames[i2], delta);
   }
}

//==============================================================================

function branchForEach(bbox, func_name, func_arg) {
   let sub1 = this.sub1;
   let sub2 = this.sub2;
   if (bbox) {
      if ((sub1.right > bbox.left) && (sub1.left < bbox.right) && (sub1.top > bbox.bottom) && (sub1.bottom < bbox.top)) {
         if ((sub1.left >= bbox.left) && (sub1.right <= bbox.right) && (sub1.bottom >= bbox.bottom) && (sub1.top <= bbox.top)) {
            sub1.forEach(null, func_name, func_arg);
         } else {
            sub1.forEach(bbox, func_name, func_arg);
         }
      }
      if ((sub2.right > bbox.left) && (sub2.left < bbox.right) && (sub2.top > bbox.bottom) && (sub2.bottom < bbox.top)) {
         if ((sub2.left >= bbox.left) && (sub2.right <= bbox.right) && (sub2.bottom >= bbox.bottom) && (sub2.top <= bbox.top)) {
            sub2.forEach(null, func_name, func_arg);
         } else {
            sub2.forEach(bbox, func_name, func_arg);
         }
      }
   } else {
      sub1.forEach(null, func_name, func_arg);
      sub2.forEach(null, func_name, func_arg);
   }
}

function leafForEach(bbox, func_name, func_arg) {
   this[func_name](func_arg);
}

function leafCollect(arr) {
   arr.push(this);
}

function leafIgnore(arr) {
   // Don't insert into the array.
}

function MapNode(json_node, vertices) {
   this.left   = json_node['bbox'][0];
   this.right  = json_node['bbox'][1];
   this.bottom = json_node['bbox'][2];
   this.top    = json_node['bbox'][3];

   if (json_node['kind'] == 'branch') {
      this.forEach = branchForEach;
      this.sub1 = new MapNode(json_node['sub1'], vertices);
      this.sub2 = new MapNode(json_node['sub2'], vertices);
      return;
   }
   if (json_node['kind'] == 'polygon') {
      this.forEach = leafForEach;
      this.collect = leafCollect;
      this.index_array = new Uint16Array(json_node['value']);
      return;
   }
   // This is an entity.
   this.forEach = leafForEach;
   this.collectShadowCaster = leafIgnore;
   this.collectCollider = leafIgnore;
   this.collectPathNode = leafIgnore;

   if (json_node['kind'] == 'edge') {
      let indexes = json_node['value'];
      this.pt1 = vertices[indexes[0]];
      this.pt2 = vertices[indexes[1]];
      this.collectShadowCaster = leafCollect;
      this.collectCollider = leafCollect;
   }
   if (json_node['kind'] == 'rectangle') {
      this.collectPathNode = leafCollect;
   }
}

//==============================================================================

function Map(gl, json) {
   let entities = json['entities'];
   let polygons = json['polygons'];
   let vertices = json['vertices'];
   this.entities_root = new MapNode(entities, vertices);
   this.polygons_root = new MapNode(polygons, vertices);
   this.map_renderer = new MapRenderer(gl, json);
   this.array_pool = new ObjectPool(
      () => new PermanentArray(),
      (arr) => arr.clear()
   );
   this.reusable_array = new PermanentArray();
   this.pathnode_queue = new PermanentPriorityQueue();
   this.initializePathNodes();
}

Map.prototype.draw = function (shader, camera) {
   let polygons = this.reusable_array;
   this.polygons_root.forEach(camera.getBoundingBox(), 'collect', polygons);
   this.map_renderer.draw(polygons.array, polygons.count, shader);
   polygons.clear();
}

Map.prototype.drawShadowMap = function (shader, camera, light_position) {
   let shadow_casters = this.reusable_array;
   this.entities_root.forEach(camera.getBoundingBox(), 'collectShadowCaster', shadow_casters);
   this.map_renderer.drawShadowMap(shadow_casters.array, shadow_casters.count, shader, camera, light_position);
   shadow_casters.clear();
}

Map.prototype.getPotentialColliders = function (start_position, delta_position, radius) {
   let potential_colliders = this.array_pool.get();
   let reach = radius + Vector2.length(delta_position);
   let bbox = BoundingBox.fromPointAndDistance(start_position, reach);
   this.entities_root.forEach(bbox, 'collectCollider', potential_colliders);
   return potential_colliders;
}

Map.prototype.checkCollision = function (start_position, delta_position, radius, potential_colliders) {
   let colliders = this.array_pool.get();
   let new_position = Vector2.add(start_position, delta_position);
   for (let i = 0; i < potential_colliders.count; i++) {
      let edge = potential_colliders.array[i];
      if (lineSegmentCircleCollide(Vector4.lineFromTwoPoints(edge.pt1, edge.pt2), new_position, radius)) {
         colliders.push(edge);
      }
   }
   return colliders;
}

Map.prototype.tryResolveCollision = function (start_position, delta_position, radius, potential_colliders) {
   let colliders = this.checkCollision(start_position, delta_position, radius, potential_colliders);
   if (colliders.count > 0) {
      let saved_delta = null;
      let saved_length = 0;
      for (let i = 0; i < colliders.count; i++) {
         // In case of collision with an edge try to move along that edge.
         let edge = colliders.array[i];
         let edge_vector = Vector2.normalize(Vector2.subtract(edge.pt1, edge.pt2));
         let try_delta = Vector2.scale(Vector2.dot(delta_position, edge_vector), edge_vector);
         let try_length = Vector2.length(try_delta);
         let try_colliders = this.checkCollision(start_position, try_delta, radius, potential_colliders);
         if (try_colliders.count == 0) {
            // Movement is possible, check if it is the best option so far (longest distance).
            if (saved_length < try_length) {
               saved_length = try_length;
               saved_delta = try_delta;
            }
         }
      }
      return saved_delta;
   } else {
      return delta_position;
   }
}

Map.prototype.tryResolveCollisionFallback = function (start_position, delta_position, radius, potential_colliders) {
   let saved_delta = null;
   let saved_nearset = null;
   let saved_dist = 0;
   // Go through all colliding edges and determine which ones are located along the lines
   // which collide with the entity start position (i.e. the shortest distance between
   // the center of the entity and the line is less than the entity radius). From them,
   // select the edge for which the movement needed to correct the collision is smallest.
   let colliders = this.checkCollision(start_position, delta_position, radius, potential_colliders);
   for (let i = 0; i < colliders.count; i++) {
      let edge = colliders.array[i];
      let nearest = Vector2.nearestPointAtLine(Vector4.lineFromTwoPoints(edge.pt1, edge.pt2), start_position);
      let dist = distanceBetweenTwoPoints(nearest, start_position);
      if (dist < radius && (!saved_nearset || saved_dist < dist)) {
         saved_nearset = nearest;
         saved_dist = dist;
      }
   }
   // Move the entity away from the selected edge (perpendicular to the edge line)
   // so that in the next step it will be possible to move the entity along the edge.
   if (saved_nearset) {
      let edge_normal = Vector2.normalize(Vector2.subtract(start_position, saved_nearset));
      let try_delta = Vector2.scale(Vector2.length(delta_position), edge_normal);
      let try_colliders = this.checkCollision(start_position, try_delta, radius, potential_colliders);
      if (try_colliders.count == 0) {
         saved_delta = try_delta;
      }
   }
   return saved_delta;
}

Map.prototype.resolveCollision = function (start_position, delta_position, radius) {
   let potential_colliders = this.getPotentialColliders(start_position, delta_position, radius);
   let num_steps = 2;
   let position = start_position;
   let step_delta = Vector2.scale(1.0 / num_steps, delta_position);
   let total_delta = Vector2.construct(0,0);
   for (let i = 0; i < num_steps; i++) {
      let try_delta = this.tryResolveCollision(position, step_delta, radius, potential_colliders);
      if (!try_delta) {
         try_delta = this.tryResolveCollisionFallback(position, step_delta, radius, potential_colliders);
      }
      if (try_delta) {
         position = Vector2.add(position, try_delta);
         total_delta = Vector2.add(total_delta, try_delta);
      }
   }
   this.array_pool.releaseAll();
   return total_delta;
}

//==============================================================================

Map.prototype.initializePathNodes = function () {
   let all_nodes = [];
   this.entities_root.forEach(null, 'collectPathNode', all_nodes);
   for (let current_node of all_nodes) {
      current_node.neighbors = [];
      current_node.overlaps = [];
      current_node.path_id = 0;
   }
   // Connect overlapping path nodes.
   for (let current_node of all_nodes) {
      let overlapping_nodes = [];
      this.entities_root.forEach(current_node, 'collectPathNode', overlapping_nodes);
      for (let other_node of overlapping_nodes) {
         // Ensure that the connection is not yet established.
         if ((current_node !== other_node) && !current_node.neighbors.includes(other_node)) {
            // Create a common "overlap" object referenced by both nodes.
            let overlap = {
               left:   Math.max(current_node.left,   other_node.left),
               right:  Math.min(current_node.right,  other_node.right),
               bottom: Math.max(current_node.bottom, other_node.bottom),
               top:    Math.min(current_node.top,    other_node.top)
            };
            overlap.center = [
               (overlap.left + overlap.right) / 2.0,
               (overlap.bottom + overlap.top) / 2.0
            ];
            current_node.neighbors.push(other_node);
            current_node.overlaps.push(overlap);
            other_node.neighbors.push(current_node);
            other_node.overlaps.push(overlap);
         }
      }
   }
   // Identifier to distinguish already visited path nodes.
   this.path_id = 0;
   this.path_end = [0,0];
}

Map.prototype.constructPathEndingAt = function (end_position) {
   this.path_id += 1;
   Vector2.copy(this.path_end, end_position);
   // Start from the path nodes at the end position.
   let start_bbox = BoundingBox.fromPointAndDistance(end_position, 0);
   let start_nodes = this.reusable_array;
   this.entities_root.forEach(start_bbox, 'collectPathNode', start_nodes);
   // Reset starting path nodes and put them to the frontier queue.
   let frontier = this.pathnode_queue;
   while (start_nodes.count > 0) {
      let node = start_nodes.pop();
      node.path_id = this.path_id;
      node.path_overlap = null;
      node.path_length = 0;
      frontier.push(node, 0);
   }
   // Dijkstra's Algorithm.
   while (!frontier.empty()) {
      // Get the node with the shortest path length from the frontier queue.
      let current_node = frontier.pop();
      for (let i = 0; i < current_node.neighbors.length; i++) {
         let other_node  = current_node.neighbors[i];
         let overlap     = current_node.overlaps[i];
         let path_length = current_node.path_length;
         // For each neighbor node, calculate path length for the current route.
         if (current_node.path_overlap) {
            path_length += distanceBetweenTwoPoints(current_node.path_overlap.center, overlap.center);
         } else {
            path_length += distanceBetweenTwoPoints(end_position, overlap.center);
         }
         // If it is the first time the neighbor node is visited, or it was already visited
         // but the current route is shorter than the previous one, then update the neighbor
         // node and put it into the frontier.
         if (other_node.path_id != this.path_id || other_node.path_length > path_length) {
            other_node.path_id = this.path_id;
            other_node.path_overlap = overlap;
            other_node.path_length = path_length;
            frontier.push(other_node, path_length);
         }
      }
   }
}

Map.prototype.getMoveTargetFromPath = function (start_position, radius) {
   let target_pos = null;
   let start_node = null;
   let start_bbox = BoundingBox.fromPointAndDistance(start_position, 0);
   let start_nodes = this.reusable_array;
   this.entities_root.forEach(start_bbox, 'collectPathNode', start_nodes);
   while (start_nodes.count > 0) {
      let node = start_nodes.pop();
      if (node.path_id == this.path_id) {
         // Select the node with the shortest path length.
         if (!start_node || (start_node.path_length > node.path_length)) {
            start_node = node;
         }
      }
   }
   if (start_node) {
      let overlap = start_node.path_overlap;
      if (!overlap) {
         // No overlap means that the start and end positions are
         // in the same path node. Move towards the end position.
         target_pos = this.path_end;
      } else {
         // If the overlapping region between the two path nodes is large enough,
         // then try to move towards the nearer part of this region. Otherwise
         // move towards the center of the region.
         let x = overlap.center[0];
         let y = overlap.center[1];
         let margin = radius * 2.0;
         if (overlap.right - overlap.left > margin * 2.0) {
            x = Math.min(Math.max(start_position[0], overlap.left + margin), overlap.right - margin);
         }
         if (overlap.top - overlap.bottom > margin * 2.0) {
            y = Math.min(Math.max(start_position[1], overlap.bottom + margin), overlap.top - margin);
         }
         target_pos = Vector2.construct(x, y);
      }
   }
   return target_pos;
}

//==============================================================================

function MovingEntity(properties) {
   let map = null;
   let look_vec = [0,0];
   let position = [0,0];
   let velocity = [0,0]; // Based on actual position changes.
   let move_vec = [0,0]; // Attempted move direction.

   this.spawn = function (spawn_map, spawn_position) {
      map = spawn_map;
      Vector2.copy(position, spawn_position);
   };
   this.getLookAngle = function () {
      if (Vector2.length(look_vec) > 0) {
         return angleFromVector(look_vec);
      } else {
         return angleFromVector(move_vec);
      }
   };
   this.getLookTarget = function () {
      return Vector2.add(position, look_vec);
   };
   this.getLookVector = function () {
      return look_vec;
   };
   this.getPosition = function () {
      return position;
   };
   this.instantlyLookAt = function (target_position) {
      Vector2.copy(look_vec, Vector2.subtract(target_position, position));
   };
   this.turnTowardsTarget = function (target_position, dt) {
      if (Vector2.length(look_vec) > 0) {
         let target_vec = Vector2.subtract(target_position, position);
         // Calculate the current and requested look angle.
         let look_angle   = angleFromVector(look_vec);
         let target_angle = angleFromVector(target_vec);
         // Check if the difference between angles exceeds the defined angular speed.
         let delta = angleDifference(target_angle, look_angle);
         let max_delta = properties.angular_speed * dt;
         // If so, then rotate the original look vector according to the angular speed.
         // Otherwise just overwrite the look vector with the new one.
         if (delta > max_delta) {
            Vector2.copy(look_vec, Vector2.transform(Matrix3.rotation(+max_delta), look_vec));
         } else if (delta < -max_delta) {
            Vector2.copy(look_vec, Vector2.transform(Matrix3.rotation(-max_delta), look_vec));
         } else {
            Vector2.copy(look_vec, target_vec);
         }
      } else {
         this.instantlyLookAt(target_position);
      }
   };
   this.moveInDirection = function (move_direction, dt) {
      // Save attempted move direction.
      Vector2.copy(move_vec, Vector2.normalize(move_direction));
      // Calculate change of the velocity from friction. Friction depends
      // on the current speed, and is equal to acceleration for max speed.
      let dv1 = Vector2.scale(-(properties.acceleration / properties.maximum_speed) * dt, velocity);
      // Calculate change of the velocity based on the given direction.
      let dv2 = Vector2.scale(properties.acceleration * dt, move_vec);
      // Calculate the resulting velocity.
      let v = Vector2.add(velocity, Vector2.add(dv1, dv2));
      // Try to move, see if there are any collisions.
      let ds1 = Vector2.scale(dt, v);
      let ds2 = map.resolveCollision(position, ds1, properties.radius);
      // Calculate the final position and velocity.
      Vector2.copy(position, Vector2.add(position, ds2));
      Vector2.copy(velocity, Vector2.scale(1.0 / dt, ds2));
   };
}
