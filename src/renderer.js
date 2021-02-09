'use strict'

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
   uniform vec3  u_light_target;
   uniform vec2  u_light_attenuation;
   uniform float u_gamma;
   varying vec2  v_texcoord;
   varying vec2  v_texcoord_shadow;
   varying vec3  v_tangent;
   varying vec3  v_bitangent;
   varying vec3  v_normal;
   varying vec3  v_position;
   const float c_ambient = 0.001;
   const float c_shininess = 64.0;
   const float c_inner_cutoff = 0.866; // cos(30 deg)
   const float c_outer_cutoff = 0.707; // cos(45 deg)

   void main(void) {
      // Read texels from textures.
      vec4 diffuse_texel  = texture2D(u_diffuse_map,  v_texcoord);
      vec4 specular_texel = texture2D(u_specular_map, v_texcoord);
      vec4 normal_texel   = texture2D(u_normal_map,   v_texcoord);
      vec4 shadow_texel   = texture2D(u_shadow_map,   v_texcoord_shadow);
      vec4 random_texel   = texture2D(u_random_map,   v_texcoord_shadow);

      float rng = 0.0;
      float shadow = 0.0;
      float s0 = v_texcoord_shadow.s;
      float t0 = v_texcoord_shadow.t;

      // Read and downscale the texture coordinate deltas.
      float ds = shadow_texel.s / 8.0;
      float dt = shadow_texel.t / 8.0;

      // Sample the shadow map multiple times with the "spread" defined by the
      // texture coordinate deltas. Using randomness prevents visible strips.
      for (float i = -1.0; i < 1.0; i += 0.5) {
         for (float j = -1.0; j < 1.0; j += 0.5) {
            rng = mod(rng * random_texel[0] + random_texel[1], 0.5);
            float s = s0 + ds*i + ds*rng;
            rng = mod(rng * random_texel[2] + random_texel[3], 0.5);
            float t = t0 + dt*j + dt*rng;
            shadow += texture2D(u_shadow_map, vec2(s,t)).a;
         }
      }

      // Calculate the final shadow value.
      shadow = 1.0 - (shadow / 16.0);
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

      // Calculate diffuse and specular scalars.
      float diffuse = max(dot(normal, to_light), 0.0);
      float specular = pow(max(dot(normal, halfway), 0.0), c_shininess);

      // Calculate luminosity values based on the light distance and its attenuation.
      float distance = length(u_light_position - v_position);
      float luminosity_point = 1.0 / (1.0 + u_light_attenuation[0] * distance * distance);
      float luminosity_spot  = 1.0 / (1.0 + u_light_attenuation[1] * distance * distance);

      // Calculate cosine of angle between light vector and light direction.
      float theta = dot(to_light, normalize(u_light_position - u_light_target));

      // Scale spotlight luminosity based on whether this fragment is within the spotlight cone.
      float intensity = clamp((theta - c_outer_cutoff) / (c_inner_cutoff - c_outer_cutoff), 0.0, 1.0);
      luminosity_spot *= intensity * intensity;

      // Final luminosity.
      float luminosity = max(luminosity_point, luminosity_spot);

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
   let loc_light_target  = gl.getUniformLocation(prog, 'u_light_target');
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
   this.setupLight = function (position, target, attenuation) {
      gl.uniform3fv(loc_light_pos, position);
      gl.uniform3fv(loc_light_target, target);
      gl.uniform2fv(loc_light_att, attenuation);
   };
   this.setupGamma = function (gamma) {
      gl.uniform1f(loc_gamma, gamma);
   };
}

//==============================================================================

const shadow_vertex_shader = `
   attribute vec4 a_vertex_info;
   uniform mat3 u_model_matrix;
   uniform mat3 u_camera_matrix;
   varying vec4 v_color;

   void main(void) {
      vec3 position = vec3(a_vertex_info.xy, 1.0);
      v_color = vec4(a_vertex_info.z, a_vertex_info.w, 0.0, 1.0);
      gl_Position = vec4((u_camera_matrix * u_model_matrix * position).xy, a_vertex_info.z, 1.0);
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
   let loc_vertex_info   = gl.getAttribLocation(prog, 'a_vertex_info');
   let loc_model_matrix  = gl.getUniformLocation(prog, 'u_model_matrix');
   let loc_camera_matrix = gl.getUniformLocation(prog, 'u_camera_matrix');
   this.enable = function () {
      gl.useProgram(prog);
      gl.enableVertexAttribArray(loc_vertex_info);
   };
   this.setupGeometry = function (buf_vertex_info) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf_vertex_info);
      gl.vertexAttribPointer(loc_vertex_info, 4, gl.FLOAT, false, 0, 0);
   };
   this.setupModel = function (matrix) {
      gl.uniformMatrix3fv(loc_model_matrix, false, matrix);
   };
   this.setupCamera = function (matrix) {
      gl.uniformMatrix3fv(loc_camera_matrix, false, matrix);
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

function Texture(gl, filter, wrap) {
   let id = gl.createTexture();
   gl.bindTexture(gl.TEXTURE_2D, id);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
   gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);

   this.getId = function () {
      return id;
   };
   this.bindTo = function (index) {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, id);
   };
}

function TextureFromImage(gl, image) {
   Texture.call(this, gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
}

function TextureFromImage_sRGB(gl, image) {
   Texture.call(this, gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
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
   Texture.call(this, gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
}

function TextureFromRandomBytes(gl, width, height) {
   let nbytes = width * height * 4;
   let pixels = new Uint8Array(nbytes);
   for (let i = 0; i < nbytes; i++) {
      pixels[i] = Math.round(Math.random() * 255.0);
   }
   TextureFromPixels.call(this, gl, width, height, pixels);
}

//==============================================================================

function TextureFramebuffer(gl, width, height) {
   let texture = new TextureFromPixels(gl, width, height, null);

   let depthbuf_id = gl.createRenderbuffer();
   gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuf_id);
   gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

   let framebuf_id = gl.createFramebuffer();
   gl.bindFramebuffer(gl.FRAMEBUFFER, framebuf_id);
   gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture.getId(), 0);
   gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuf_id);

   this.bind = function () {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuf_id);
      gl.viewport(0, 0, width, height);
   };
   this.bindTextureTo = function (index) {
      texture.bindTo(index);
   };
}

function CanvasFramebuffer(gl, canvas) {
   this.bind = function () {
      let cw = canvas.clientWidth;
      let ch = canvas.clientHeight;
      if ((canvas.width != cw) || (canvas.height != ch)) {
         canvas.width  = cw;
         canvas.height = ch;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
   };
   this.getAspectRatio = function () {
      return (canvas.clientWidth / canvas.clientHeight);
   };
   // Return a rectangle with pixel dimensions of the canvas.
   // Unlike the webgl coordinates, the vertical axis goes downwards.
   this.getBoundingRect = function () {
      return canvas.getBoundingClientRect();
   };
}

function Camera(canvas_framebuf, min_width, min_height) {
   let camera_angle = 0;
   let camera_pos = [0,0,0];
   let view_width = null;
   let view_height = null;

   this.setAngle = function (angle) {
      camera_angle = angle;
   };
   this.setPosition = function (position) {
      camera_pos = position;
   };
   this.getAngle = function () {
      return camera_angle;
   };
   this.getPosition = function () {
      return camera_pos;
   };
   this.getMatrix = function () {
      let ratio = canvas_framebuf.getAspectRatio();
      if ((min_width / min_height) < ratio) {
         view_width  = min_height * ratio;
         view_height = min_height;
      } else {
         view_width  = min_width;
         view_height = min_width / ratio;
      }
      return Matrix3.multiply(
         Matrix3.scale([2.0 / view_width, 2.0 / view_height]),
         Matrix3.multiply(
            Matrix3.rotation(-camera_angle),
            Matrix3.translation(Vector2.scale(-1.0, camera_pos))
         )
      );
   };
   this.getBoundingBox = function () {
      let mat = Matrix3.inverse(this.getMatrix());
      let pt1 = Vector2.transform(mat, [-1, +1]);
      let pt2 = Vector2.transform(mat, [-1, -1]);
      let pt3 = Vector2.transform(mat, [+1, -1]);
      let pt4 = Vector2.transform(mat, [+1, +1]);
      return {
         left:   Math.min(pt1[0], pt2[0], pt3[0], pt4[0]),
         right:  Math.max(pt1[0], pt2[0], pt3[0], pt4[0]),
         bottom: Math.min(pt1[1], pt2[1], pt3[1], pt4[1]),
         top:    Math.max(pt1[1], pt2[1], pt3[1], pt4[1])
      };
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
   this.maxsize = maxsize;
   gl.bindBuffer(gl.ARRAY_BUFFER, this.id);
   gl.bufferData(gl.ARRAY_BUFFER, this.maxsize, gl.DYNAMIC_DRAW);
}

function DynamicElementArrayBuffer(gl, maxsize) {
   this.id = gl.createBuffer();
   this.count = 0;
   this.maxsize = maxsize;
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.id);
   gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.maxsize, gl.DYNAMIC_DRAW);
}

//==============================================================================

function ModelRenderer(gl, json) {
   let polygons  = json['polygons'];
   let texcoords = json['texcoords'];
   let vertices  = json['vertices'];
   this.glcontext = gl;
   this.index_buffer = new ElementArrayBuffer(gl, polygons);
   this.texcoord_buffer = new ArrayBuffer(gl, texcoords);
   this.tangent_buffers = {};
   this.vertex_buffers = {};
   for (let anim_name in vertices) {
      this.tangent_buffers[anim_name] = vertices[anim_name].map(function (frame) {
         return new ArrayBuffer(gl, calculateTangents(polygons, texcoords, frame));
      });
      this.vertex_buffers[anim_name] = vertices[anim_name].map(function (frame) {
         return new ArrayBuffer(gl, frame);
      });
   }
}

ModelRenderer.prototype.draw = function (shader, anim_name, anim_pos) {
   let gl = this.glcontext;
   let texcoords = this.texcoord_buffer;
   let tangents = this.tangent_buffers[anim_name];
   let vertices = this.vertex_buffers[anim_name];
   // Select two frames to interpolate between.
   let n = Math.min(Math.max(anim_pos, 0.0), 1.0) * (vertices.length-1);
   let i1 = Math.trunc(n);
   let i2 = (i1 + 1) % vertices.length;
   let delta = n - i1;
   shader.setupGeometry(texcoords.id, tangents[i1].id, tangents[i2].id, vertices[i1].id, vertices[i2].id, delta);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index_buffer.id);
   gl.drawElements(gl.TRIANGLES, this.index_buffer.count, gl.UNSIGNED_SHORT, 0);
}

//==============================================================================

function getMapPolygons(json_node) {
   let polygons = [];
   if (json_node['kind'] == 'polygon') {
      polygons.push(json_node['value']);
   } else {
      polygons = polygons.concat(getMapPolygons(json_node['sub1']));
      polygons = polygons.concat(getMapPolygons(json_node['sub2']));
   }
   return polygons;
}

function MapRenderer(gl, json) {
   let polygons  = json['polygons'];
   let texcoords = json['texcoords'];
   let vertices  = json['vertices'];
   this.glcontext = gl;
   this.texcoord_buffer = new ArrayBuffer(gl, texcoords);
   this.tangent_buffer = new ArrayBuffer(gl, calculateTangents(getMapPolygons(polygons), texcoords, vertices));
   this.vertex_buffer = new ArrayBuffer(gl, vertices);
   this.index_buffer = new DynamicElementArrayBuffer(gl, 64*1024);
   this.shadow_buffer = new DynamicArrayBuffer(gl, 256*1024);
}

MapRenderer.prototype.draw = function (polygons, shader, camera) {
   let gl = this.glcontext;
   let buf = this.index_buffer;
   let flush_buffer = function () {
      gl.drawElements(gl.TRIANGLES, buf.count, gl.UNSIGNED_SHORT, 0);
      buf.count = 0;
   };
   let add_geometry = function (index_array) {
      if ((buf.count + index_array.length) * 2 > buf.maxsize) { // 2 bytes per value (Uint16).
         flush_buffer();
      }
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, (buf.count * 2), new Uint16Array(index_array));
      buf.count += index_array.length;
   };
   shader.setupGeometry(this.texcoord_buffer.id, this.tangent_buffer.id, this.tangent_buffer.id, this.vertex_buffer.id, this.vertex_buffer.id, 0);
   gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.id);
   for (let node of polygons) {
      add_geometry(node.index_array);
   }
   flush_buffer();
}

MapRenderer.prototype.drawShadowMap = function (shadow_casters, shader, camera, light_position) {
   let gl = this.glcontext;
   let buf = this.shadow_buffer;
   let flush_buffer = function () {
      gl.drawArrays(gl.TRIANGLES, 0, buf.count / 4); // Each vertex has 4 components.
      buf.count = 0;
   };
   let add_geometry = function (vertex_array) {
      if ((buf.count + vertex_array.length) * 4 > buf.maxsize) { // 4 bytes per value (Float32).
         flush_buffer();
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, (buf.count * 4), new Float32Array(vertex_array));
      buf.count += vertex_array.length;
   };
   shader.setupGeometry(buf.id);
   // WebGL setup.
   gl.enable(gl.BLEND);
   // Draw alpha component only (not RGB).
   gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ONE, gl.ZERO);
   for (let node of shadow_casters) {
      castShadowAlpha(add_geometry, light_position, node.pt1, node.pt2, camera.getBoundingBox());
   }
   flush_buffer();
   // Clear depth buffer before the next pass.
   gl.clear(gl.DEPTH_BUFFER_BIT);
   // Draw RGB components only (not alpha).
   gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ZERO, gl.ONE);
   for (let node of shadow_casters) {
      castShadowColor(add_geometry, light_position, node.pt1, node.pt2, camera.getBoundingBox());
   }
   flush_buffer();
   // WebGL cleanup.
   gl.disable(gl.BLEND);
}

//==============================================================================

function castShadowAlpha(add_geometry_func, light_pt, edge_pt1, edge_pt2, camera_bbox) {
   let angle1 = angleFromVector(Vector2.subtract(edge_pt1, light_pt));
   let angle2 = angleFromVector(Vector2.subtract(edge_pt2, light_pt));
   let angle = angleAverage(angle1, angle2);
   // If the shadow angles are too wide then divide the edge into two parts and process
   // each part separately. This is to avoid drawing very large triangles.
   if (angleDifference(angle1, angle2) > Math.PI/2) {
      let l1 = lineFromTwoPoints(edge_pt1, edge_pt2);
      let l2 = lineFromPointAndAngle(light_pt, angle);
      let pt = lineIntersection(l1, l2);
      if (pt) {
         castShadowAlpha(add_geometry_func, light_pt, edge_pt1, pt, camera_bbox);
         castShadowAlpha(add_geometry_func, light_pt, edge_pt2, pt, camera_bbox);
      }
   } else {
      // Make sure the bounding box is large enough, but don't modify the original one.
      let bbox = {
         left:   Math.min(camera_bbox.left,   edge_pt1[0], edge_pt2[0]),
         right:  Math.max(camera_bbox.right,  edge_pt1[0], edge_pt2[0]),
         bottom: Math.min(camera_bbox.bottom, edge_pt1[1], edge_pt2[1]),
         top:    Math.max(camera_bbox.top,    edge_pt1[1], edge_pt2[1])
      };
      // Cast the edge points along the shadow angles onto the precalculated line.
      // This line is outside of the bounding box and is perpendicular to the average
      // of the shadow angles. That way we don't need to handle corners of the bounding
      // box when drawing the shadow.
      let l0 = linePerpendicularToAngleOutsideOfBbox(angle, bbox);
      let l1 = lineFromPointAndAngle(edge_pt1, angle1);
      let l2 = lineFromPointAndAngle(edge_pt2, angle2);
      let pt1 = lineIntersection(l0, l1);
      let pt2 = lineIntersection(l0, l2);
      if (pt1 && pt2) {
         add_geometry_func([
            edge_pt1[0], edge_pt1[1], 0.0, 0.0,
            edge_pt2[0], edge_pt2[1], 0.0, 0.0,
            pt1[0],      pt1[1],      0.0, 0.0,
            edge_pt2[0], edge_pt2[1], 0.0, 0.0,
            pt1[0],      pt1[1],      0.0, 0.0,
            pt2[0],      pt2[1],      0.0, 0.0
         ]);
      }
   }
}

function castShadowColor(add_geometry_func, light_pt, edge_pt1, edge_pt2, camera_bbox) {
   let angle1 = angleFromVector(Vector2.subtract(edge_pt1, light_pt));
   let angle2 = angleFromVector(Vector2.subtract(edge_pt2, light_pt));
   let angle = angleAverage(angle1, angle2);
   if (angleDifference(angle1, angle2) > Math.PI/2) {
      let l1 = lineFromTwoPoints(edge_pt1, edge_pt2);
      let l2 = lineFromPointAndAngle(light_pt, angle);
      let pt = lineIntersection(l1, l2);
      if (pt) {
         castShadowColor(add_geometry_func, light_pt, edge_pt1, pt, camera_bbox);
         castShadowColor(add_geometry_func, light_pt, edge_pt2, pt, camera_bbox);
      }
   } else {
      let bbox = {
         left:   Math.min(camera_bbox.left,   edge_pt1[0], edge_pt2[0]),
         right:  Math.max(camera_bbox.right,  edge_pt1[0], edge_pt2[0]),
         bottom: Math.min(camera_bbox.bottom, edge_pt1[1], edge_pt2[1]),
         top:    Math.max(camera_bbox.top,    edge_pt1[1], edge_pt2[1])
      };
      // Make sure that "1" identifies the angle of lesser value.
      if ((angle1 > angle2 && angle1 - angle2 < Math.PI) ||
          (angle2 > angle1 && angle2 - angle1 > Math.PI)) {
         let swap = angle1;
         angle1 = angle2;
         angle2 = swap;
         swap = edge_pt1;
         edge_pt1 = edge_pt2;
         edge_pt2 = swap;
      }
      // The angle below specifies the area near the borders of a shadow where the shadow
      // will be "soft". We need to make the drawn geometry wider to include this entire area.
      const delta_angle = 5.0 * Math.PI/180.0;
      angle1 -= delta_angle;
      angle2 += delta_angle;
      // Make sure that the updated angles are in the correct range.
      if (angle1 <= -Math.PI) angle1 += 2*Math.PI;
      if (angle2 >   Math.PI) angle2 -= 2*Math.PI;
      // Cast the edge points onto the line outside of the
      // bounding box and perpendicular to the average angle.
      let l0 = linePerpendicularToAngleOutsideOfBbox(angle, bbox);
      let l1 = lineFromPointAndAngle(edge_pt1, angle1);
      let l2 = lineFromPointAndAngle(edge_pt2, angle2);
      let pt1 = lineIntersection(l0, l1);
      let pt2 = lineIntersection(l0, l2);
      if (pt1 && pt2) {
         // Calculate the "spread" of the shadow map sampling which implements soft shadows.
         // This spread will be saved as texture coordinate deltas in the shadow map color components.
         let cam_width  = camera_bbox.right - camera_bbox.left;
         let cam_height = camera_bbox.top - camera_bbox.bottom;
         let delta_tan  = Math.tan(delta_angle);
         let dist1 = distanceBetweenTwoPoints(edge_pt1, pt1);
         let dist2 = distanceBetweenTwoPoints(edge_pt2, pt2);
         // Upscale the texture coordinate deltas for better usage of the color range.
         // The upscale factor needs to be consistent with the fragment shader.
         let ds1 = 8.0 * dist1 * delta_tan / cam_width;
         let ds2 = 8.0 * dist2 * delta_tan / cam_width;
         let dt1 = 8.0 * dist1 * delta_tan / cam_height;
         let dt2 = 8.0 * dist2 * delta_tan / cam_height;
         add_geometry_func([
            edge_pt1[0], edge_pt1[1], 0.0, 0.0,
            edge_pt2[0], edge_pt2[1], 0.0, 0.0,
            pt1[0],      pt1[1],      ds1, dt1,
            edge_pt2[0], edge_pt2[1], 0.0, 0.0,
            pt1[0],      pt1[1],      ds1, dt1,
            pt2[0],      pt2[1],      ds2, dt2
         ]);
      }
   }
}
