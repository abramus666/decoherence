
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

Map.prototype.drawShadowMap = function (shader, camera, light) {
   let shadow_casters = [];
   let collect_shadow_caster = function (node) {
      if (node.is_shadow_caster) {
         shadow_casters.push(node);
      }
   };
   this.entities_root.traverse(collect_shadow_caster, camera.getBoundingBox());
   this.map_renderer.drawShadowMap(shadow_casters, shader, camera, light);
}

Map.prototype.getPotentialColliders = function (entity, delta_position) {
   let potential_colliders = [];
   let reach = entity.radius + Vector2.length(delta_position);
   let bbox = {
      left:   entity.position[0] - reach,
      right:  entity.position[0] + reach,
      bottom: entity.position[1] - reach,
      top:    entity.position[1] + reach
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

Map.prototype.resolveCollision = function (entity, delta_position) {
   let potential_colliders = this.getPotentialColliders(entity, delta_position);
   let num_steps = 2;
   let position = entity.position;
   let step_delta = Vector2.scale(1.0 / num_steps, delta_position);
   let total_delta = [0,0];
   for (let i = 0; i < num_steps; i++) {
      let try_delta = tryResolveCollision(position, step_delta, entity.radius, potential_colliders);
      if (!try_delta) {
         try_delta = tryResolveCollisionFallback(position, step_delta, entity.radius, potential_colliders);
      }
      if (try_delta) {
         position = Vector2.add(position, try_delta);
         total_delta = Vector2.add(total_delta, try_delta);
      }
   }
   return total_delta;
}
