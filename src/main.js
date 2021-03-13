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
   acceleration:  25.0,
   maximum_speed: 5.0,
   angular_speed: 2.0*Math.PI,
   radius:        0.5,
   diffuse_url:   'model/test.diff.png',
   specular_url:  'model/test.spec.png',
   normal_url:    'model/test.norm.png',
   model_url:     'model/test.json'
};

const ENEMY_PROPERTIES = {
   acceleration:  25.0,
   maximum_speed: 2.0,
   angular_speed: 2.0*Math.PI,
   radius:        0.5,
   diffuse_url:   'model/test.diff.png',
   specular_url:  'model/test.spec.png',
   normal_url:    'model/test.norm.png',
   model_url:     'model/test.json'
};

const RESOURCES = [
   MAP01_PROPERTIES,
   PLAYER_PROPERTIES,
   ENEMY_PROPERTIES
];

const KEY_A = 65;
const KEY_D = 68;
const KEY_S = 83;
const KEY_W = 87;

let globals = {};

//==============================================================================

function renderAll() {
   let gl = globals.glcontext;

   // Determine the light parameters.
   Vector2.copy(globals.light.position, globals.player.getPosition());
   Vector2.copy(globals.light.target,   globals.player.getLookTarget());

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
   globals.map.drawShadowMap(globals.shadow_shader, globals.camera, globals.light.position);
   // WebGL cleanup.
   gl.disable(gl.DEPTH_TEST);

   // Prepare for drawing on the canvas.
   globals.canvas_framebuf.bind();
   globals.default_shader.enable();
   globals.default_shader.setupCamera(globals.camera.getMatrix(), globals.camera.getPosition());
   globals.default_shader.setupLight(globals.light.position, globals.light.target, globals.light.attenuation);
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
   // Draw the enemy.
   globals.default_shader.setupModel(
      Matrix3.multiply(
         Matrix3.translation(globals.enemy.getPosition()),
         Matrix3.rotation(globals.enemy.getLookAngle())
      )
   );
   globals.enemy.diffuse.bindTo(0);
   globals.enemy.specular.bindTo(1);
   globals.enemy.normal.bindTo(2);
   globals.enemy.model.draw(globals.default_shader, '', 0);
   // Draw the map.
   globals.default_shader.setupModel(Matrix3.identity());
   globals.map.diffuse.bindTo(0);
   globals.map.specular.bindTo(1);
   globals.map.normal.bindTo(2);
   globals.map.draw(globals.default_shader, globals.camera);
   // WebGL cleanup.
   gl.disable(gl.DEPTH_TEST);
}

function updateCamera(dt) {
   // Update the camera angle by the amount based on the mouse coordinates.
   // Nonlinear rotation, fastest when the mouse cursor is at the edge of the screen
   // (maximum angular speed is defined in the player properties).
   let camera_angle = globals.camera.getAngle();
   camera_angle -= globals.mousepos[0] * Math.abs(globals.mousepos[0]) * PLAYER_PROPERTIES.angular_speed * dt;
   // Make sure that the updated angle is in the correct range.
   if (camera_angle <= -Math.PI) camera_angle += 2*Math.PI;
   if (camera_angle >   Math.PI) camera_angle -= 2*Math.PI;
   // Update the camera position.
   let camera_dir = Vector2.transform(Matrix3.rotation(camera_angle), Vector2.construct(0,1));
   let delta_pos  = Vector2.scale(globals.camera.getViewHeight()/2-1, camera_dir);
   let camera_pos = Vector2.add(globals.player.getPosition(), delta_pos);
   globals.camera.setAngle(camera_angle);
   globals.camera.setPosition(camera_pos);
}

function updatePlayer(dt) {
   let key_forward = (KEY_W in globals.keyboard && globals.keyboard[KEY_W]);
   let key_back    = (KEY_S in globals.keyboard && globals.keyboard[KEY_S]);
   let key_left    = (KEY_A in globals.keyboard && globals.keyboard[KEY_A]);
   let key_right   = (KEY_D in globals.keyboard && globals.keyboard[KEY_D]);
   // Update the player position and angle using direction based on the mouse coordinates.
   let inv_camera = Matrix3.inverse(globals.camera.getMatrix());
   let target_pos = Vector2.transform(inv_camera, globals.mousepos);
   let look_dir = Vector2.subtract(target_pos, globals.player.getPosition());
   let move_dir = Vector2.construct(0,0);
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
   globals.player.instantlyLookAt(target_pos);
   globals.player.moveInDirection(move_dir, dt);
   // Construct a path for traversal towards the player.
   globals.map.constructPathEndingAt(globals.player.getPosition());
}

function updateEnemy(dt) {
   let target_pos = globals.map.getMoveTargetFromPath(globals.enemy.getPosition(), ENEMY_PROPERTIES.radius);
   if (target_pos) {
      globals.enemy.turnTowardsTarget(target_pos, dt);
      if (distanceBetweenTwoPoints(globals.player.getPosition(), globals.enemy.getPosition()) > 1) {
         globals.enemy.moveInDirection(globals.enemy.getLookVector(), dt);
      }
   }
}

function updateAll(dt) {
   updateCamera(dt);
   updatePlayer(dt);
   updateEnemy(dt);
}

function initializeAll() {
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

   globals.enemy          = new MovingEntity(ENEMY_PROPERTIES);
   globals.enemy.model    = globals.resource_loader.get(ENEMY_PROPERTIES.model_url);
   globals.enemy.diffuse  = globals.resource_loader.get(ENEMY_PROPERTIES.diffuse_url);
   globals.enemy.specular = globals.resource_loader.get(ENEMY_PROPERTIES.specular_url);
   globals.enemy.normal   = globals.resource_loader.get(ENEMY_PROPERTIES.normal_url);
   globals.enemy.spawn(globals.map, [7,1]);

   globals.light             = {};
   globals.light.position    = [0,0,1];
   globals.light.target      = [0,0,0];
   globals.light.attenuation = [100,1];
}

//==============================================================================

function releasePools() {
   BoundingBox.pool.releaseAll();
   Vector2.pool.releaseAll();
   Vector4.pool.releaseAll();
   Matrix3.pool.releaseAll();
}

function tick(timestamp) {
   const t_prev = globals.updated_time;
   const t = timestamp / 1000.0;
   const dt = GAME_PROPERTIES.step_time;
   while (globals.updated_time + dt <= t) {
      globals.updated_time += dt;
      updateAll(dt);
      releasePools();
   }
   if (globals.updated_time > t_prev) {
      renderAll();
      releasePools();
   }
   window.requestAnimationFrame(tick);
}

function tickWait(timestamp) {
   globals.updated_time = timestamp / 1000.0;
   if (globals.resource_loader.completed()) {
      initializeAll();
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
