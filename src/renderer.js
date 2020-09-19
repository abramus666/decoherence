
function buildShaderProgram(gl, vs_source, fs_source) {

   function compileShaderProgram(type, source) {
      let shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
   }

   let vs = compileShaderProgram(gl.VERTEX_SHADER, vs_source);
   let fs = compileShaderProgram(gl.FRAGMENT_SHADER, fs_source);
   let prog = gl.createProgram();
   gl.attachShader(prog, vs);
   gl.attachShader(prog, fs);
   gl.linkProgram(prog);
   if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      let vs_info = gl.getShaderInfoLog(vs);
      if (vs_info.length > 0) {
         console.error(vs_info);
      }
      let fs_info = gl.getShaderInfoLog(fs);
      if (fs_info.length > 0) {
         console.error(fs_info);
      }
      let prog_info = gl.getProgramInfoLog(prog);
      if (prog_info.length > 0) {
         console.error(prog_info);
      }
   }
   return prog;
}

//==============================================================================

const default_vertex_shader = `
   attribute vec2 a_texcoord;
   attribute vec2 a_tangent1;
   attribute vec2 a_tangent2;
   attribute vec2 a_position1;
   attribute vec2 a_position2;
   uniform float u_position_delta;
   uniform mat3  u_model_matrix;
   uniform mat3  u_camera_matrix;
   varying vec2  v_texcoord;
   varying vec2  v_texcoord_shadow;
   varying vec3  v_tangent;
   varying vec3  v_bitangent;
   varying vec3  v_normal;
   varying vec3  v_position;

   void main(void) {
      // Perform linear interpolation based on animation position.
      vec3 tangent  = vec3(mix(a_tangent1,  a_tangent2,  u_position_delta), 0.0);
      vec3 position = vec3(mix(a_position1, a_position2, u_position_delta), 1.0);

      // Bitangent vector is a cross product of normal and tangent vectors.
      // It needs to be calculated before the vectors are transformed.
      // "Vertex" normal is constant for 2D geometry.
      vec3 normal = vec3(0.0, 0.0, 1.0);
      vec3 bitangent = cross(normal, tangent);

      // Pass texture coordinates to the fragment shader.
      v_texcoord = a_texcoord;

      // Transform tangent/bitangent/normal vectors to world space,
      // and pass them to the fragment shader. Assume there is no
      // non-uniform scale, therefore model matrix can be used.
      v_tangent   = u_model_matrix * tangent;
      v_bitangent = u_model_matrix * bitangent;
      v_normal    = normal;

      // Transform position to world space, and pass it to the fragment shader.
      v_position = vec3((u_model_matrix * position).xy, 0.0);

      // Calculate the position in camera space.
      // Z=1 for multiplication by matrix since those are 2D transformations.
      // Z=0, W=1 in the final value.
      gl_Position = vec4((u_camera_matrix * u_model_matrix * position).xy, 0.0, 1.0);

      // Calculate texture coordinates for shadow map based on the position
      // in camera space, and pass them to the fragment shader.
      v_texcoord_shadow = vec2(gl_Position.x * 0.5 + 0.5, gl_Position.y * 0.5 + 0.5);
   }
`;

const default_fragment_shader = `
   #ifdef GL_FRAGMENT_PRECISION_HIGH
   precision highp float;
   #else
   precision mediump float;
   #endif

   uniform sampler2D u_diffuse_map;
   uniform sampler2D u_specular_map;
   uniform sampler2D u_normal_map;
   uniform sampler2D u_shadow_map;
   uniform sampler2D u_random_map;
   uniform vec3  u_camera_position;
   uniform vec3  u_light_position;
   uniform float u_light_attenuation;
   uniform float u_gamma;
   varying vec2  v_texcoord;
   varying vec2  v_texcoord_shadow;
   varying vec3  v_tangent;
   varying vec3  v_bitangent;
   varying vec3  v_normal;
   varying vec3  v_position;
   const float c_ambient = 0.001;
   const float c_shininess = 64.0;

   void main(void) {
      // Read texels from textures.
      vec4 diffuse_texel  = texture2D(u_diffuse_map,  v_texcoord);
      vec4 specular_texel = texture2D(u_specular_map, v_texcoord);
      vec4 normal_texel   = texture2D(u_normal_map,   v_texcoord);
      vec4 shadow_texel   = texture2D(u_shadow_map,   v_texcoord_shadow);
      vec4 random_texel   = texture2D(u_random_map,   v_texcoord_shadow);

      float rng = 0.0;
      float shadow = 0.0;
      float ds = 0.005 * shadow_texel.s;
      float dt = 0.010 * shadow_texel.t;
      float s0 = v_texcoord_shadow.s;
      float t0 = v_texcoord_shadow.t;

      for (float i = -2.0; i < 2.0; i += 1.0) {
         for (float j = -2.0; j < 2.0; j += 1.0) {
            rng = fract(rng * random_texel[0] + random_texel[1]);
            float s = s0 + ds*i + ds*rng;
            rng = fract(rng * random_texel[2] + random_texel[3]);
            float t = t0 + dt*j + dt*rng;
            shadow += texture2D(u_shadow_map, vec2(s,t)).a;
         }
      }

      shadow /= 16.0;
      shadow = 1.0 - shadow;
      shadow = pow(shadow, u_gamma);



      // Calculate base color from the ambient value and diffuse texel.
      vec3 color = c_ambient * diffuse_texel.rgb;

      // Construct TBN matrix to transform from tangent to world space.
      vec3 t = normalize(v_tangent);
      vec3 b = normalize(v_bitangent);
      vec3 n = normalize(v_normal);
      mat3 tbn = mat3(t, b, n);

      // Calculate "fragment" normal vector and transform it to world space.
      vec3 normal = normalize(tbn * (normal_texel.rgb * 2.0 - 1.0));

      // Calculate camera vector.
      vec3 to_camera = normalize(u_camera_position - v_position);

      // Calculate light vector and "halfway" vector between light and camera vectors.
      vec3 to_light = normalize(u_light_position - v_position);
      vec3 halfway = normalize(to_light + to_camera);

      // Calculate luminosity based on the light distance and its attenuation.
      float distance = length(u_light_position - v_position);
      float luminosity = 1.0 / (1.0 + u_light_attenuation * distance * distance);

      // Calculate diffuse and specular scalars.
      float diffuse = max(dot(normal, to_light), 0.0);
      float specular = pow(max(dot(normal, halfway), 0.0), c_shininess);

      // Add diffuse and specular colors to the final color.
      color += shadow * luminosity * ((diffuse * diffuse_texel.rgb) + (specular * specular_texel.rgb));

      // Apply gamma correction to the final color.
      color = pow(color, vec3(1.0 / u_gamma));

      // Merge final color with the alpha component from diffuse texel.
      gl_FragColor = vec4(color, diffuse_texel.a);
   }
`;

function DefaultShader(gl) {
   let prog = buildShaderProgram(gl, default_vertex_shader, default_fragment_shader);
   let loc_texcoord      = gl.getAttribLocation(prog, 'a_texcoord');
   let loc_tangent1      = gl.getAttribLocation(prog, 'a_tangent1');
   let loc_tangent2      = gl.getAttribLocation(prog, 'a_tangent2');
   let loc_position1     = gl.getAttribLocation(prog, 'a_position1');
   let loc_position2     = gl.getAttribLocation(prog, 'a_position2');
   let loc_pos_delta     = gl.getUniformLocation(prog, 'u_position_delta');
   let loc_model_matrix  = gl.getUniformLocation(prog, 'u_model_matrix');
   let loc_camera_matrix = gl.getUniformLocation(prog, 'u_camera_matrix');
   let loc_camera_pos    = gl.getUniformLocation(prog, 'u_camera_position');
   let loc_light_pos     = gl.getUniformLocation(prog, 'u_light_position');
   let loc_light_att     = gl.getUniformLocation(prog, 'u_light_attenuation');
   let loc_gamma         = gl.getUniformLocation(prog, 'u_gamma');
   let loc_diffuse_map   = gl.getUniformLocation(prog, 'u_diffuse_map');
   let loc_specular_map  = gl.getUniformLocation(prog, 'u_specular_map');
   let loc_normal_map    = gl.getUniformLocation(prog, 'u_normal_map');
   let loc_shadow_map    = gl.getUniformLocation(prog, 'u_shadow_map');
   let loc_random_map    = gl.getUniformLocation(prog, 'u_random_map');
   this.enable = function () {
      gl.useProgram(prog);
      gl.enableVertexAttribArray(loc_texcoord);
      gl.enableVertexAttribArray(loc_tangent1);
      gl.enableVertexAttribArray(loc_tangent2);
      gl.enableVertexAttribArray(loc_position1);
      gl.enableVertexAttribArray(loc_position2);
      gl.uniform1i(loc_diffuse_map,  0);
      gl.uniform1i(loc_specular_map, 1);
      gl.uniform1i(loc_normal_map,   2);
      gl.uniform1i(loc_shadow_map,   3);
      gl.uniform1i(loc_random_map,   4);
   };
   this.setupGeometry = function (buf_texcoord, buf_tangent1, buf_tangent2, buf_position1, buf_position2, position_delta) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf_texcoord);
      gl.vertexAttribPointer(loc_texcoord, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf_tangent1);
      gl.vertexAttribPointer(loc_tangent1, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf_tangent2);
      gl.vertexAttribPointer(loc_tangent2, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf_position1);
      gl.vertexAttribPointer(loc_position1, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf_position2);
      gl.vertexAttribPointer(loc_position2, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(loc_pos_delta, position_delta);
   };
   this.setupModel = function (matrix) {
      gl.uniformMatrix3fv(loc_model_matrix, false, matrix);
   };
   this.setupCamera = function (matrix, position) {
      gl.uniformMatrix3fv(loc_camera_matrix, false, matrix);
      gl.uniform3fv(loc_camera_pos, position);
   };
   this.setupLight = function (position, attenuation) {
      gl.uniform3fv(loc_light_pos, position);
      gl.uniform1f(loc_light_att, attenuation);
   };
   this.setupGamma = function (gamma) {
      gl.uniform1f(loc_gamma, gamma);
   };
}

//==============================================================================

const shadow_vertex_shader = `
   attribute vec3 a_position;
   uniform mat3 u_model_matrix;
   uniform mat3 u_camera_matrix;
   varying vec4 v_color;

   void main(void) {
      vec3 position = vec3(a_position.xy, 1.0);
      v_color = vec4(a_position.zzz, 1.0);
      gl_Position = vec4((u_camera_matrix * u_model_matrix * position).xy, a_position.z, 1.0);
   }
`;

const shadow_fragment_shader = `
   precision mediump float;
   varying vec4 v_color;

   void main(void) {
      gl_FragColor = v_color;
   }
`;

function ShadowShader(gl) {
   let prog = buildShaderProgram(gl, shadow_vertex_shader, shadow_fragment_shader);
   let loc_position      = gl.getAttribLocation(prog, 'a_position');
   let loc_model_matrix  = gl.getUniformLocation(prog, 'u_model_matrix');
   let loc_camera_matrix = gl.getUniformLocation(prog, 'u_camera_matrix');
   this.enable = function () {
      gl.useProgram(prog);
      gl.enableVertexAttribArray(loc_position);
   };
   this.setupGeometry = function (buf_position) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf_position);
      gl.vertexAttribPointer(loc_position, 3, gl.FLOAT, false, 0, 0);
   };
   this.setupModel = function (matrix) {
      gl.uniformMatrix3fv(loc_model_matrix, false, matrix);
   };
   this.setupCamera = function (matrix) {
      gl.uniformMatrix3fv(loc_camera_matrix, false, matrix);
   };
}

//==============================================================================

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

//==============================================================================

function linearizeImage(image) {
   let canvas = document.createElement('canvas');
   let context = canvas.getContext('2d');
   canvas.width = image.width;
   canvas.height = image.height;
   context.drawImage(image, 0, 0);
   let img = context.getImageData(0, 0, image.width, image.height);
   let pixels = new Uint8Array(img.data.length);
   for (let i = 0; i < img.data.length; i++) {
      // Don't touch the alpha component.
      if ((i % 4) != 3) {
         // Linearize according to the sRGB standard.
         let c = img.data[i] / 255.0;
         if (c <= 0.04045) {
            c = c / 12.92;
         } else {
            c = Math.pow(((c + 0.055) / 1.055), 2.4);
         }
         pixels[i] = Math.round(c * 255.0);
      } else {
         pixels[i] = img.data[i];
      }
   }
   return pixels;
}

function createAndSetupTexture(gl, filter, wrap) {
   let id = gl.createTexture();
   gl.bindTexture(gl.TEXTURE_2D, id);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
   return id;
}

function TextureFromImage(gl, image) {
   this.glcontext = gl;
   this.id = createAndSetupTexture(gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
}

function TextureFromImage_sRGB(gl, image) {
   this.glcontext = gl;
   this.id = createAndSetupTexture(gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
   // Using extension is preferable because storing linearized
   // colors with 8-bit resolution will cause loss of information.
   let ext = gl.getExtension('EXT_sRGB');
   if (ext) {
      gl.texImage2D(gl.TEXTURE_2D, 0, ext.SRGB_ALPHA_EXT, ext.SRGB_ALPHA_EXT, gl.UNSIGNED_BYTE, image);
   } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, linearizeImage(image));
   }
}

function TextureFromPixels(gl, width, height, pixels) {
   this.glcontext = gl;
   this.id = createAndSetupTexture(gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
}

function TextureFromRandomBytes(gl, width, height) {
   this.glcontext = gl;
   this.id = createAndSetupTexture(gl, gl.LINEAR, gl.REPEAT);
   let nbytes = width * height * 4;
   let pixels = new Uint8Array(nbytes);
   for (let i = 0; i < nbytes; i++) {
      pixels[i] = Math.round(Math.random() * 255.0);
   }
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
}

TextureFromImage.prototype.bindTo =
TextureFromImage_sRGB.prototype.bindTo =
TextureFromPixels.prototype.bindTo =
TextureFromRandomBytes.prototype.bindTo = function (index) {
   let gl = this.glcontext;
   gl.activeTexture(gl.TEXTURE0 + index);
   gl.bindTexture(gl.TEXTURE_2D, this.id);
}

//==============================================================================

function Framebuffer(gl, width, height) {
   let texture = new TextureFromPixels(gl, width, height, null);

   let depthbuf_id = gl.createRenderbuffer();
   gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuf_id);
   gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

   let framebuf_id = gl.createFramebuffer();
   gl.bindFramebuffer(gl.FRAMEBUFFER, framebuf_id);
   gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.id, 0);
   gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuf_id);

   this.bind = function () {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuf_id);
      gl.viewport(0, 0, width, height);
   };
   this.bindTextureTo = function (index) {
      texture.bindTo(index);
   };
}

//==============================================================================

function calculateTangent(vix1, vix2, vix3, texcoords, vertices) {
   let ds1 = texcoords[vix2][0] - texcoords[vix1][0];
   let dt1 = texcoords[vix2][1] - texcoords[vix1][1];
   let ds2 = texcoords[vix3][0] - texcoords[vix1][0];
   let dt2 = texcoords[vix3][1] - texcoords[vix1][1];
   let dx1 = vertices[vix2][0] - vertices[vix1][0];
   let dy1 = vertices[vix2][1] - vertices[vix1][1];
   let dx2 = vertices[vix3][0] - vertices[vix1][0];
   let dy2 = vertices[vix3][1] - vertices[vix1][1];
   let f = 1.0 / (ds1 * dt2 - ds2 * dt1);
   let tx = f * (dt2 * dx1 - dt1 * dx2);
   let ty = f * (dt2 * dy1 - dt1 * dy2);
   return [tx, ty];
}

function calculateTangents(polygons, texcoords, vertices) {
   let tangents = vertices.map(function (v) {return [0,0,0];});
   let triangles = polygons.flat();
   // Calculate tangent vectors for all triangles. Tangent vector for a vertex
   // is an average of tangent vectors for all triangles this vectex belongs to.
   for (let i = 0; i < triangles.length; i += 3) {
      let vix1 = triangles[i];
      let vix2 = triangles[i+1];
      let vix3 = triangles[i+2];
      let t = calculateTangent(vix1, vix2, vix3, texcoords, vertices);
      for (let vix of [vix1, vix2, vix3]) {
         tangents[vix][0] += t[0];
         tangents[vix][1] += t[1];
         tangents[vix][2] += 1; // Keeps the count of tangent vectors to be averaged.
      }
   }
   for (let vix = 0; vix < tangents.length; vix++) {
      let tx = 0;
      let ty = 0;
      if (tangents[vix][2] > 0) {
         tx = tangents[vix][0] / tangents[vix][2];
         ty = tangents[vix][1] / tangents[vix][2];
      }
      tangents[vix] = [tx, ty];
   }
   return tangents;
}

//==============================================================================

function ArrayBuffer(gl, array) {
   let arr = array.flat();
   this.id = gl.createBuffer();
   this.count = arr.length;
   gl.bindBuffer(gl.ARRAY_BUFFER, this.id);
   gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
}

function ElementArrayBuffer(gl, array) {
   let arr = array.flat();
   this.id = gl.createBuffer();
   this.count = arr.length;
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.id);
   gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(arr), gl.STATIC_DRAW);
}

function DynamicArrayBuffer(gl, maxsize) {
   this.id = gl.createBuffer();
   this.count = 0;
   gl.bindBuffer(gl.ARRAY_BUFFER, this.id);
   gl.bufferData(gl.ARRAY_BUFFER, maxsize, gl.DYNAMIC_DRAW);
}

function DynamicElementArrayBuffer(gl, maxsize) {
   this.id = gl.createBuffer();
   this.count = 0;
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.id);
   gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, maxsize, gl.DYNAMIC_DRAW);
}

//==============================================================================

function Model(gl, json) {
   let polygons  = json['polygons'];
   let texcoords = json['texcoords'];
   let vertices  = json['vertices'];
   this.glcontext = gl;
   this.index_buffer = new ElementArrayBuffer(gl, polygons);
   this.texcoord_buffer = new ArrayBuffer(gl, texcoords);
   this.tangent_buffers = {};
   this.vertex_buffers = {};
   for (let anim_name in vertices) {
      tangent_bufs[anim_name] = vertices[anim_name].map(function (frame) {
         return new ArrayBuffer(gl, calculateTangents(polygons, texcoords, frame));
      });
      vertex_bufs[anim_name] = vertices[anim_name].map(function (frame) {
         return new ArrayBuffer(gl, frame);
      });
   }
}

Model.prototype.draw = function (shader, anim_name, anim_pos) {
   if (anim_pos < 0.0) anim_pos = 0.0;
   if (anim_pos > 1.0) anim_pos = 1.0;
   let gl = this.glcontext;
   let texcoords = this.texcoord_buffer;
   let tangents = this.tangent_buffers[anim_name];
   let vertices = this.vertex_buffers[anim_name];
   let n = anim_pos * (vertices.length-1);
   let i1 = Math.trunc(n);
   let i2 = (i1 + 1) % vertices.length;
   let delta = n - i1;
   shader.setupGeometry(texcoords.id, tangents[i1].id, tangents[i2].id, vertices[i1].id, vertices[i2].id, delta);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index_buffer.id);
   gl.drawElements(gl.TRIANGLES, this.index_buffer.count, gl.UNSIGNED_SHORT, 0);
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

function EntityNode(json_node, vertices) {
   this.left   = json_node['bbox'][0];
   this.right  = json_node['bbox'][1];
   this.bottom = json_node['bbox'][2];
   this.top    = json_node['bbox'][3];
   if (json_node['kind'] == 'branch') {
      this.traverse = traverseBranch;
      this.sub1 = new EntityNode(json_node['sub1'], vertices);
      this.sub2 = new EntityNode(json_node['sub2'], vertices);
   } else {
      this.traverse = traverseLeaf;
      let indexes = json_node['value'];
      if (json_node['kind'] == 'edge') {
         this.pt1 = vertices[indexes[0]];
         this.pt2 = vertices[indexes[1]];
      }
   }
}

function PolygonNode(json_node) {
   this.left   = json_node['bbox'][0];
   this.right  = json_node['bbox'][1];
   this.bottom = json_node['bbox'][2];
   this.top    = json_node['bbox'][3];
   if (json_node['kind'] == 'branch') {
      this.traverse = traverseBranch;
      this.sub1 = new PolygonNode(json_node['sub1']);
      this.sub2 = new PolygonNode(json_node['sub2']);
   } else {
      this.traverse = traverseLeaf;
      if (json_node['kind'] == 'polygon') {
         this.arr = new Uint16Array(json_node['value']);
      }
   }
}

//==============================================================================

function getPolygons(json_node) {
   let polygons = [];
   if (json_node['kind'] == 'polygon') {
      polygons.push(json_node['value']);
   } else {
      polygons = polygons.concat(getPolygons(json_node['sub1']));
      polygons = polygons.concat(getPolygons(json_node['sub2']));
   }
   return polygons;
}

function Map(gl, json) {
   let entities  = json['entities'];
   let polygons  = json['polygons'];
   let texcoords = json['texcoords'];
   let vertices  = json['vertices'];
   this.glcontext = gl;
   this.entities_root = new EntityNode(entities, vertices);
   this.polygons_root = new PolygonNode(polygons);
   this.texcoord_buffer = new ArrayBuffer(gl, texcoords);
   this.tangent_buffer = new ArrayBuffer(gl, calculateTangents(getPolygons(polygons), texcoords, vertices));
   this.vertex_buffer = new ArrayBuffer(gl, vertices);
   this.index_buffer = new DynamicElementArrayBuffer(gl, 4*1024);
   this.shadow_buffer = new DynamicArrayBuffer(gl, 256*1024);
}

Map.prototype.draw = function (shader, camera) {
   let gl = this.glcontext;
   let buf = this.index_buffer;
   let collect_polygon = function (node) {
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, (buf.count * 2), node.arr);
      buf.count += node.arr.length;
   };
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.id);
   this.polygons_root.traverse(collect_polygon, camera.getBoundingBox());
   shader.setupGeometry(this.texcoord_buffer.id, this.tangent_buffer.id, this.tangent_buffer.id, this.vertex_buffer.id, this.vertex_buffer.id, 0);
   gl.drawElements(gl.TRIANGLES, buf.count, gl.UNSIGNED_SHORT, 0);
   buf.count = 0;
}







Map.prototype.drawShadowMapAlpha = function (shader, camera, light) {
   let gl = this.glcontext;
   let buf = this.shadow_buffer;
   let bbox = camera.getBoundingBox();
   let add_geometry = function (arr) {
      gl.bufferSubData(gl.ARRAY_BUFFER, (buf.count * 4), new Float32Array(arr));
      buf.count += arr.length;
   };
   let collect_edge = function (node) {
      castShadow(add_geometry, light, node, bbox);
   };
   gl.bindBuffer(gl.ARRAY_BUFFER, buf.id);
   this.entities_root.traverse(collect_edge, bbox);
   shader.setupGeometry(buf.id);
   gl.drawArrays(gl.TRIANGLES, 0, buf.count / 3); // Each vertex has 3 components.
   buf.count = 0;
}

Map.prototype.drawShadowMapColor = function (shader, camera, light) {
   let gl = this.glcontext;
   let buf = this.shadow_buffer;
   let bbox = camera.getBoundingBox();
   let add_geometry = function (arr) {
      gl.bufferSubData(gl.ARRAY_BUFFER, (buf.count * 4), new Float32Array(arr));
      buf.count += arr.length;
   };
   let collect_edge = function (node) {
      sharpenShadow(add_geometry, node.pt1);
      sharpenShadow(add_geometry, node.pt2);
   };
   gl.bindBuffer(gl.ARRAY_BUFFER, buf.id);
   this.entities_root.traverse(collect_edge, bbox);
   shader.setupGeometry(buf.id);
   gl.drawArrays(gl.TRIANGLES, 0, buf.count / 3); // Each vertex has 3 components.
   buf.count = 0;
}











/* Results of atan2(y,x) converted to degrees:
 *    
 *     135    90    45
 *           y ^
 *             |
 *     180 ----+---> 0
 *             |   x
 *             |
 *    -135   -90   -45
 */

// Project a point at the specified angle into one of line segments
// of a bounding box. The point must be within the bounding box.
// The angle must be in range (-pi, pi].
function projectPoint(point, angle, bbox) {
   let x = 0;
   let y = 0;
   let tg = Math.tan(angle);
   if (angle >= 0) {
      x = point[0] + (bbox.top - point[1]) / tg;
      y = bbox.top;
   } else {
      x = point[0] + (bbox.bottom - point[1]) / tg;
      y = bbox.bottom;
   }
   if (x > bbox.right) {
      x = bbox.right;
      y = point[1] + (bbox.right - point[0]) * tg;
   } else if (x < bbox.left) {
      x = bbox.left;
      y = point[1] + (bbox.left - point[0]) * tg;
   }
   return [x, y];
}





function castShadow(add_geometry_func, light, edge, camera_bbox) {
   let edge_pt1 = edge.pt1;
   let edge_pt2 = edge.pt2;
   // Calculate angles for shadows casted from points of the edge.
   let angle1 = Math.atan2(edge_pt1[1] - light.position[1], edge_pt1[0] - light.position[0]);
   let angle2 = Math.atan2(edge_pt2[1] - light.position[1], edge_pt2[0] - light.position[0]);
   // Make sure that '1' identifies the angle of lesser value.
   if (angle1 > angle2) {
      let a = angle1;
      angle1 = angle2;
      angle2 = a;
      edge_pt1 = edge.pt2;
      edge_pt2 = edge.pt1;
   }

   // TODO: Precalculate
   // Make sure the bounding box is large enough, but don't modify the original one.
   let bbox = {
      left:   Math.min(camera_bbox.left,   edge_pt1[0], edge_pt2[0]),
      right:  Math.max(camera_bbox.right,  edge_pt1[0], edge_pt2[0]),
      bottom: Math.min(camera_bbox.bottom, edge_pt1[1], edge_pt2[1]),
      top:    Math.max(camera_bbox.top,    edge_pt1[1], edge_pt2[1])
   };
   // Project edge points into the bounding box.
   let bbox_pt1 = projectPoint(edge_pt1, angle1, bbox);
   let bbox_pt2 = projectPoint(edge_pt2, angle2, bbox);




   // TODO: Precalculate
   let angle_bl = Math.atan2(bbox.bottom - light.position[1], bbox.left  - light.position[0]);
   let angle_br = Math.atan2(bbox.bottom - light.position[1], bbox.right - light.position[0]);
   let angle_tl = Math.atan2(bbox.top    - light.position[1], bbox.left  - light.position[0]);
   let angle_tr = Math.atan2(bbox.top    - light.position[1], bbox.right - light.position[0]);

   // corners must be sorted by their angles in ascending order.
   let corners = [
      {angle: angle_bl, point: [bbox.left,  bbox.bottom]},
      {angle: angle_br, point: [bbox.right, bbox.bottom]},
      {angle: angle_tl, point: [bbox.left,  bbox.top]},
      {angle: angle_tr, point: [bbox.right, bbox.top]}
   ];
   corners.sort((a,b) => a.angle - b.angle);



   let arr = [
      edge_pt1[0], edge_pt1[1], 0.0,
      edge_pt2[0], edge_pt2[1], 0.0,
      bbox_pt1[0], bbox_pt1[1], 0.0,
      edge_pt2[0], edge_pt2[1], 0.0,
      bbox_pt1[0], bbox_pt1[1], 0.0,
      bbox_pt2[0], bbox_pt2[1], 0.0
   ];
   if (angle2 - angle1 < Math.PI) {
      for (let corner of corners) {
         if (angle1 < corner.angle && corner.angle < angle2) {
            arr = arr.concat(arr.slice(-6), corner.point, [0.0]);
         }
      }
   } else {
      for (let corner of corners) {
         if (angle1 > corner.angle || corner.angle > angle2) {
            arr = arr.concat(arr.slice(-6), corner.point, [0.0]);
         }
      }
   }

   add_geometry_func(arr);
}















function sharpenShadow(add_geometry_func, edge_pt) {
   let radius = 1;
   let count = 8;

   let geometry = [];
   let dx1 = radius;
   let dy1 = 0;
   let angle = 0;
   let delta = 2*Math.PI / count;
   while (count > 0) {
      count -= 1;
      angle += delta;
      let dx2 =  Math.cos(angle) * radius;
      let dy2 = -Math.sin(angle) * radius;
      geometry = geometry.concat([
         edge_pt[0],     edge_pt[1],     0.0,
         edge_pt[0]+dx1, edge_pt[1]+dy1, 1.0,
         edge_pt[0]+dx2, edge_pt[1]+dy2, 1.0
      ]);
      dx1 = dx2;
      dy1 = dy2;
   }
   add_geometry_func(geometry);
}




