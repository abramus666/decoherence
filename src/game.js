
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

function returnFalse() {
   return false;
}

function returnTrue() {
   return true;
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
      this.isShadowCaster = returnFalse;

      if (json_node['kind'] == 'edge') {
         let indexes = json_node['value'];
         this.pt1 = vertices[indexes[0]];
         this.pt2 = vertices[indexes[1]];
         this.isShadowCaster = returnTrue;
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
      if (node.isShadowCaster()) {
         shadow_casters.push(node);
      }
   };
   this.entities_root.traverse(collect_shadow_caster, camera.getBoundingBox());
   this.map_renderer.drawShadowMap(shadow_casters, shader, camera, light);
}
