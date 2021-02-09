'use strict'

const GAME_PROPERTIES = {
   step_time:        1.0 / 60.0,
   default_gamma:    2.2,
   min_gamma:        1.8,
   max_gamma:        2.6,
   shadowmap_width:  1024,
   shadowmap_height: 512,
   min_display_size: 9
};

const MAP01_PROPERTIES = {
   diffuse_url:  'map/test.diff.png',
   specular_url: 'map/test.spec.png',
   normal_url:   'map/test.norm.png',
   map_url:      'map/test.json'
};

const PLAYER_PROPERTIES = {
   acceleration: 25.0,
   max_speed:    5.0,
   radius:       0.5,
   diffuse_url:  'model/test.diff.png',
   specular_url: 'model/test.spec.png',
   normal_url:   'model/test.norm.png',
   model_url:    'model/test.json'
};

const RESOURCES = [
   MAP01_PROPERTIES,
   PLAYER_PROPERTIES
];

const KEY_A = 65;
const KEY_D = 68;
const KEY_S = 83;
const KEY_W = 87;

let globals = {};

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

function gameRender() {
   let gl = globals.glcontext;

   // Determine the light parameters.
   let light = {
      position:    globals.player.getPosition().concat(1), // Add "z" vector component.
      target:      globals.player.getLookTarget().concat(0), // Add "z" vector component.
      attenuation: [100, 1]
   };

   // Prepare for drawing on the shadowmap framebuffer.
   globals.shadow_framebuf.bind();
   globals.shadow_shader.enable();
   globals.shadow_shader.setupModel(Matrix3.identity());
   globals.shadow_shader.setupCamera(globals.camera.getMatrix());
   // WebGL setup.
   gl.enable(gl.DEPTH_TEST);
   gl.depthFunc(gl.LESS);
   gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
   // Draw the shadows.
   globals.map.drawShadowMap(globals.shadow_shader, globals.camera, light.position);
   // WebGL cleanup.
   gl.disable(gl.DEPTH_TEST);

   // Prepare for drawing on the canvas.
   globals.canvas_framebuf.bind();
   globals.default_shader.enable();
   globals.default_shader.setupCamera(globals.camera.getMatrix(), globals.camera.getPosition());
   globals.default_shader.setupLight(light.position, light.target, light.attenuation);
   globals.default_shader.setupGamma(globals.gamma);
   globals.shadow_framebuf.bindTextureTo(3);
   globals.texture_random.bindTo(4);
   // WebGL setup.
   gl.enable(gl.DEPTH_TEST);
   gl.depthFunc(gl.LESS);
   gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
   // Draw the player.
   globals.default_shader.setupModel(
      Matrix3.multiply(
         Matrix3.translation(globals.player.getPosition()),
         Matrix3.rotation(globals.player.getLookAngle())
      )
   );
   globals.player.diffuse.bindTo(0);
   globals.player.specular.bindTo(1);
   globals.player.normal.bindTo(2);
   globals.player.model.draw(globals.default_shader, '', 0);
   // Draw the map.
   globals.default_shader.setupModel(Matrix3.identity());
   globals.map.diffuse.bindTo(0);
   globals.map.specular.bindTo(1);
   globals.map.normal.bindTo(2);
   globals.map.draw(globals.default_shader, globals.camera);
   // WebGL cleanup.
   gl.disable(gl.DEPTH_TEST);
}

function gameUpdate(dt) {
   let key_forward = (KEY_W in globals.keyboard && globals.keyboard[KEY_W]);
   let key_back    = (KEY_S in globals.keyboard && globals.keyboard[KEY_S]);
   let key_left    = (KEY_A in globals.keyboard && globals.keyboard[KEY_A]);
   let key_right   = (KEY_D in globals.keyboard && globals.keyboard[KEY_D]);

   // Update the camera angle by the amount based on the mouse coordinates.
   // Nonlinear rotation, at most 360 degrees per second
   // (when the mouse cursor is at the edge of the screen).
   let camera_angle = globals.camera.getAngle();
   camera_angle -= globals.mousepos[0] * Math.abs(globals.mousepos[0]) * Math.PI * 2.0 / 60.0;
   if (camera_angle <= -Math.PI) camera_angle += 2*Math.PI;
   if (camera_angle >   Math.PI) camera_angle -= 2*Math.PI;
   globals.camera.setAngle(camera_angle);

   // Update the player position and angle using direction based on the mouse coordinates.
   let inv_camera = Matrix3.inverse(globals.camera.getMatrix());
   let target_pos = Vector2.transform(inv_camera, globals.mousepos);
   let look_dir = Vector2.subtract(target_pos, globals.player.getPosition());
   let move_dir = [0,0];
   if (key_forward) {
      move_dir[0] += look_dir[0];
      move_dir[1] += look_dir[1];
   }
   if (key_back) {
      move_dir[0] -= look_dir[0];
      move_dir[1] -= look_dir[1];
   }
   if (key_left) {
      move_dir[0] -= look_dir[1];
      move_dir[1] += look_dir[0];
   }
   if (key_right) {
      move_dir[0] += look_dir[1];
      move_dir[1] -= look_dir[0];
   }
   globals.player.lookAt(target_pos);
   globals.player.moveInDirection(move_dir, dt);

   // Update the camera position.
   let player_pos = globals.player.getPosition();
   let camera_dir = Vector2.transform(Matrix3.rotation(camera_angle), [0,1]);
   let camera_pos = Vector2.add(Vector2.scale(GAME_PROPERTIES.min_display_size/2-1, camera_dir), player_pos);
   globals.camera.setPosition(camera_pos.concat(0)); // Add "z" vector component.
}

function gameInitialize() {
   globals.map          = globals.resource_loader.get(MAP01_PROPERTIES.map_url);
   globals.map.diffuse  = globals.resource_loader.get(MAP01_PROPERTIES.diffuse_url);
   globals.map.specular = globals.resource_loader.get(MAP01_PROPERTIES.specular_url);
   globals.map.normal   = globals.resource_loader.get(MAP01_PROPERTIES.normal_url);

   globals.player          = new MovingEntity(PLAYER_PROPERTIES);
   globals.player.model    = globals.resource_loader.get(PLAYER_PROPERTIES.model_url);
   globals.player.diffuse  = globals.resource_loader.get(PLAYER_PROPERTIES.diffuse_url);
   globals.player.specular = globals.resource_loader.get(PLAYER_PROPERTIES.specular_url);
   globals.player.normal   = globals.resource_loader.get(PLAYER_PROPERTIES.normal_url);
   globals.player.spawn(globals.map, [0,0]);
}

//==============================================================================

function tick(timestamp) {
   const t_prev = globals.updated_time;
   const t = timestamp / 1000.0;
   const dt = GAME_PROPERTIES.step_time;
   while (globals.updated_time + dt <= t) {
      globals.updated_time += dt;
      gameUpdate(dt);
   }
   if (globals.updated_time > t_prev) {
      gameRender();
   }
   window.requestAnimationFrame(tick);
}

function tickWait(timestamp) {
   globals.updated_time = timestamp / 1000.0;
   if (globals.resource_loader.completed()) {
      gameInitialize();
      tick(timestamp);
   } else {
      window.requestAnimationFrame(tickWait);
   }
}

function keydown(evt) {
   globals.keyboard[evt.keyCode] = true;
}

function keyup(evt) {
   globals.keyboard[evt.keyCode] = false;
}

function mouseMove(evt) {
   // Transform mouse coordinates to the range [-1,1],
   // with (1,1) being the top-right corner of the screen.
   let rect = globals.canvas_framebuf.getBoundingRect();
   globals.mousepos[0] = 2.0 * (evt.clientX - rect.left) / (rect.right - rect.left) - 1.0;
   globals.mousepos[1] = -2.0 * (evt.clientY - rect.top) / (rect.bottom - rect.top) + 1.0;
}

function mouseWheel(evt) {
   if (evt.deltaY < 0) {
      globals.gamma = Math.max(globals.gamma - 0.1, GAME_PROPERTIES.min_gamma);
   }
   if (evt.deltaY > 0) {
      globals.gamma = Math.min(globals.gamma + 0.1, GAME_PROPERTIES.max_gamma);
   }
}

window.onload = function () {
   let canvas = document.getElementById('gl');
   let gl = canvas.getContext('webgl');
   if (gl) {
      globals.glcontext = gl;
      globals.resource_loader = new ResourceLoader(gl);
      for (let res of RESOURCES) {
         if (res.diffuse_url)  globals.resource_loader.loadTexture_sRGB(res.diffuse_url);
         if (res.specular_url) globals.resource_loader.loadTexture(res.specular_url);
         if (res.normal_url)   globals.resource_loader.loadTexture(res.normal_url);
         if (res.map_url)      globals.resource_loader.loadMap(res.map_url);
         if (res.model_url)    globals.resource_loader.loadModel(res.model_url);
      }
      globals.default_shader = new DefaultShader(gl);
      globals.shadow_shader = new ShadowShader(gl);
      globals.texture_random = new TextureFromRandomBytes(gl, GAME_PROPERTIES.shadowmap_width, GAME_PROPERTIES.shadowmap_height);
      globals.shadow_framebuf = new TextureFramebuffer(gl, GAME_PROPERTIES.shadowmap_width, GAME_PROPERTIES.shadowmap_height);
      globals.canvas_framebuf = new CanvasFramebuffer(gl, canvas);
      globals.camera = new Camera(globals.canvas_framebuf, GAME_PROPERTIES.min_display_size, GAME_PROPERTIES.min_display_size);
      globals.gamma = GAME_PROPERTIES.default_gamma;
      globals.keyboard = {};
      globals.mousepos = [0,0];
      document.onkeydown = keydown;
      document.onkeyup = keyup;
      document.onmousemove = mouseMove;
      document.onwheel = mouseWheel;
      window.requestAnimationFrame(tickWait);
   } else {
      console.error('WebGL not supported');
   }
};
