'use strict'

function interpolateBetweenPoints(frame1, frame2, delta) {
   return [
      frame1[0] + (frame2[0] - frame1[0]) * delta,
      frame1[1] + (frame2[1] - frame1[1]) * delta
   ];
}
function interpolateBetweenCircles(frame1, frame2, delta) {
   return {
      radius: frame1.radius + (frame2.radius - frame1.radius) * delta,
      center: interpolateBetweenPoints(frame1.center, frame2.center, delta)
   };
}
function interpolateBetweenEdges(frame1, frame2, delta) {
   return {
      pt1: interpolateBetweenPoints(frame1.pt1, frame2.pt1, delta),
      pt2: interpolateBetweenPoints(frame1.pt2, frame2.pt2, delta)
   };
}

function getModelEntities(json) {
   let vertices = json['vertices'];
   let entities = {};
   for (let entity of json['entities']) {
      let name = entity['name'];
      let val = entity['value'];
      // Save the appropriate interpolation function for the given entity type.
      // Determine entity coordinates for all animation frames.
      if (entity['kind'] == 'point') {
         entities[name] = {interpolate_func: interpolateBetweenPoints};
         for (let anim_name in vertices) {
            entities[name][anim_name] = vertices[anim_name].map(function (frame) {
               return frame[val];
            });
         }
      } else if (entity['kind'] == 'circle') {
         entities[name] = {interpolate_func: interpolateBetweenCircles};
         for (let anim_name in vertices) {
            entities[name][anim_name] = vertices[anim_name].map(function (frame) {
               return {
                  radius: distanceBetweenTwoPoints(frame[val[0]], frame[val[1]]),
                  center: frame[val[0]]
               };
            });
         }
      } else if (entity['kind'] == 'edge') {
         entities[name] = {interpolate_func: interpolateBetweenEdges};
         for (let anim_name in vertices) {
            entities[name][anim_name] = vertices[anim_name].map(function (frame) {
               return {
                  pt1: frame[val[0]],
                  pt2: frame[val[1]]
               };
            });
         }
      }
   }
   return entities;
}

function Model(gl, json) {
   this.entities = getModelEntities(json);
   this.model_renderer = new ModelRenderer(gl, json);
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
      return this.entities[entity_name].interpolate_func(frames[i1], frames[i2], delta);
   }
}

//==============================================================================

function traverseBranch(func, bbox) {
   let sub1 = this.sub1;
   let sub2 = this.sub2;
   if (bbox) {
      if ((sub1.right > bbox.left) && (sub1.left < bbox.right) && (sub1.top > bbox.bottom) && (sub1.bottom < bbox.top)) {
         if ((sub1.left >= bbox.left) && (sub1.right <= bbox.right) && (sub1.bottom >= bbox.bottom) && (sub1.top <= bbox.top)) {
            sub1.traverse(func, null);
         } else {
            sub1.traverse(func, bbox);
         }
      }
      if ((sub2.right > bbox.left) && (sub2.left < bbox.right) && (sub2.top > bbox.bottom) && (sub2.bottom < bbox.top)) {
         if ((sub2.left >= bbox.left) && (sub2.right <= bbox.right) && (sub2.bottom >= bbox.bottom) && (sub2.top <= bbox.top)) {
            sub2.traverse(func, null);
         } else {
            sub2.traverse(func, bbox);
         }
      }
   } else {
      sub1.traverse(func, null);
      sub2.traverse(func, null);
   }
}

function traverseLeaf(func, bbox) {
   func(this);
}

function MapNode(json_node, vertices) {
   this.left   = json_node['bbox'][0];
   this.right  = json_node['bbox'][1];
   this.bottom = json_node['bbox'][2];
   this.top    = json_node['bbox'][3];

   if (json_node['kind'] == 'branch') {
      this.traverse = traverseBranch;
      this.sub1 = new MapNode(json_node['sub1'], vertices);
      this.sub2 = new MapNode(json_node['sub2'], vertices);
   } else if (json_node['kind'] == 'polygon') {
      this.traverse = traverseLeaf;
      this.index_array = json_node['value'];
   } else { // Entities.
      this.traverse = traverseLeaf;
      this.is_shadow_caster = false;
      this.is_collider = false;

      if (json_node['kind'] == 'edge') {
         let indexes = json_node['value'];
         this.pt1 = vertices[indexes[0]];
         this.pt2 = vertices[indexes[1]];
         this.is_shadow_caster = true;
         this.is_collider = true;
      }
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
}

Map.prototype.draw = function (shader, camera) {
   let polygons = [];
   let collect_polygon = function (node) {
      polygons.push(node);
   };
   this.polygons_root.traverse(collect_polygon, camera.getBoundingBox());
   this.map_renderer.draw(polygons, shader, camera);
}

Map.prototype.drawShadowMap = function (shader, camera, light_position) {
   let shadow_casters = [];
   let collect_shadow_caster = function (node) {
      if (node.is_shadow_caster) {
         shadow_casters.push(node);
      }
   };
   this.entities_root.traverse(collect_shadow_caster, camera.getBoundingBox());
   this.map_renderer.drawShadowMap(shadow_casters, shader, camera, light_position);
}

Map.prototype.getPotentialColliders = function (start_position, delta_position, radius) {
   let potential_colliders = [];
   let reach = radius + Vector2.length(delta_position);
   let bbox = {
      left:   start_position[0] - reach,
      right:  start_position[0] + reach,
      bottom: start_position[1] - reach,
      top:    start_position[1] + reach
   };
   let collect_collider = function (node) {
      if (node.is_collider) {
         potential_colliders.push(node);
      }
   };
   this.entities_root.traverse(collect_collider, bbox);
   return potential_colliders;
}

function checkCollision(start_position, delta_position, radius, potential_colliders) {
   let new_position = Vector2.add(start_position, delta_position);
   let colliders = [];
   for (let edge of potential_colliders) {
      if (lineSegmentCircleCollide(lineFromTwoPoints(edge.pt1, edge.pt2), new_position, radius)) {
         colliders.push(edge);
      }
   }
   return colliders;
}

function tryResolveCollision(start_position, delta_position, radius, potential_colliders) {
   let colliders = checkCollision(start_position, delta_position, radius, potential_colliders);
   if (colliders.length > 0) {
      let saved_delta = null;
      let saved_length = 0;
      for (let edge of colliders) {
         // In case of collision with an edge try to move along that edge.
         let edge_vector = Vector2.normalize(Vector2.subtract(edge.pt1, edge.pt2));
         let try_delta = Vector2.scale(Vector2.dot(delta_position, edge_vector), edge_vector);
         let try_length = Vector2.length(try_delta);
         let try_colliders = checkCollision(start_position, try_delta, radius, potential_colliders);
         if (try_colliders.length == 0) {
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

function tryResolveCollisionFallback(start_position, delta_position, radius, potential_colliders) {
   let saved_delta = null;
   let saved_nearset = null;
   let saved_dist = 0;
   // Go through all colliding edges and determine which ones are located along the lines
   // which collide with the entity start position (i.e. the shortest distance between
   // the center of the entity and the line is less than the entity radius). From them,
   // select the edge for which the movement needed to correct the collision is smallest.
   let colliders = checkCollision(start_position, delta_position, radius, potential_colliders);
   for (let edge of colliders) {
      let nearest = nearestPointAtLine(lineFromTwoPoints(edge.pt1, edge.pt2), start_position);
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
      let try_colliders = checkCollision(start_position, try_delta, radius, potential_colliders);
      if (try_colliders.length == 0) {
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
   let total_delta = [0,0];
   for (let i = 0; i < num_steps; i++) {
      let try_delta = tryResolveCollision(position, step_delta, radius, potential_colliders);
      if (!try_delta) {
         try_delta = tryResolveCollisionFallback(position, step_delta, radius, potential_colliders);
      }
      if (try_delta) {
         position = Vector2.add(position, try_delta);
         total_delta = Vector2.add(total_delta, try_delta);
      }
   }
   return total_delta;
}

//==============================================================================

function MovingEntity(properties) {
   let map = null;
   let look_target = null;
   let position = null;
   let velocity = [0,0]; // Based on actual position changes.
   let move_dir = [0,0]; // Attempted move direction.

   this.spawn = function (spawn_map, spawn_position) {
      map = spawn_map;
      position = spawn_position;
   };
   this.getLookAngle = function () {
      let look_dir = move_dir;
      if (look_target) {
         look_dir = Vector2.subtract(look_target, position);
      }
      return angleFromVector(look_dir);
   };
   this.getLookTarget = function () {
      return look_target;
   };
   this.getPosition = function () {
      return position;
   };
   this.lookAt = function (target_position) {
      look_target = target_position;
   };
   this.moveInDirection = function (move_direction, dt) {
      // Save attempted move direction.
      move_dir = Vector2.normalize(move_direction);
      // Calculate change of the velocity from friction. Friction depends
      // on the current speed, and is equal to acceleration for max speed.
      let dv1 = Vector2.scale(-(properties.acceleration / properties.max_speed) * dt, velocity);
      // Calculate change of the velocity based on the given direction.
      let dv2 = Vector2.scale(properties.acceleration * dt, move_dir);
      // Calculate the resulting velocity.
      let v = Vector2.add(velocity, Vector2.add(dv1, dv2));
      // Try to move, see if there are any collisions.
      let ds1 = Vector2.scale(dt, v);
      let ds2 = map.resolveCollision(position, ds1, properties.radius);
      // Calculate the final position and velocity.
      position = Vector2.add(position, ds2);
      velocity = Vector2.scale(1.0 / dt, ds2);
   };
}
