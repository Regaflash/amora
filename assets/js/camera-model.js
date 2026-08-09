/**
 * Amora Studio — the rangefinder body that shows up in the #gear section.
 *
 * Built out of named meshes with named materials so the OBJ/GLB exports come
 * out labelled. Dimensions are real-world metres, y-up, feet resting on y = 0.
 *
 * <three-d-stage> ships no environment map, so metalness stays under ~0.4 and
 * the metal look is carried by the base colour instead.
 */

const stage = document.querySelector('three-d-stage');

// The loading veil lives and dies in THIS module: added here, removed after
// setObject below (or on failure). If this module never runs there is no
// veil, so nothing can strand a spinner over the fallback still.
const shell = document.querySelector('.stage-shell');
if (shell) shell.classList.add('is-loading');

let THREE;
try {
  ({ THREE } = await stage.ready);
} catch (e) {
  if (shell) shell.classList.remove('is-loading');
  throw e;
}

const M = {
  leather: new THREE.MeshStandardMaterial({ name: 'leatherette', color: 0x241f1b, roughness: 0.92, metalness: 0.05 }),
  brass:   new THREE.MeshStandardMaterial({ name: 'champagne_brass', color: 0xc9ae8c, roughness: 0.34, metalness: 0.38 }),
  sand:    new THREE.MeshStandardMaterial({ name: 'sand_anodized', color: 0xd9c3a5, roughness: 0.45, metalness: 0.25 }),
  metal:   new THREE.MeshStandardMaterial({ name: 'dark_metal', color: 0x4a423a, roughness: 0.5, metalness: 0.35 }),
  glass:   new THREE.MeshStandardMaterial({ name: 'lens_glass', color: 0x1a1714, roughness: 0.06, metalness: 0.3 })
};

const cam = new THREE.Group();
cam.name = 'amora_camera';

const add = (name, geo, mat, pos, rot) => {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  cam.add(m);
  return m;
};
const CY = (rt, rb, h, seg = 48, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const zRot = [Math.PI / 2, 0, 0];

const bodyH = 0.072, bodyW = 0.134, bodyD = 0.044;
const yBase = 0.0055;                 // feet height — base rests at y = 0
const yMid = yBase + bodyH / 2;

// --- גוף ---
add('body_core', new THREE.BoxGeometry(bodyW, bodyH, bodyD), M.metal, [0, yMid, 0]);
add('leatherette_front', new THREE.BoxGeometry(bodyW * 0.985, bodyH * 0.62, bodyD + 0.0018), M.leather, [0, yMid - 0.004, 0]);
add('leatherette_wrap', new THREE.BoxGeometry(bodyW + 0.0018, bodyH * 0.62, bodyD * 0.98), M.leather, [0, yMid - 0.004, 0]);

// --- לוחית עליונה ותחתונה ---
add('top_plate', new THREE.BoxGeometry(bodyW + 0.0016, 0.0135, bodyD + 0.0016), M.brass, [0, yBase + bodyH - 0.0068, 0]);
add('top_plate_edge', new THREE.BoxGeometry(bodyW - 0.006, 0.0022, bodyD - 0.006), M.sand, [0, yBase + bodyH + 0.0011, 0]);
add('bottom_plate', new THREE.BoxGeometry(bodyW + 0.0016, 0.008, bodyD + 0.0016), M.brass, [0, yBase + 0.0035, 0]);
add('foot_left', CY(0.006, 0.006, 0.0055, 24), M.metal, [-0.048, yBase / 2, 0.011]);
add('foot_right', CY(0.006, 0.006, 0.0055, 24), M.metal, [0.048, yBase / 2, 0.011]);
add('tripod_socket', CY(0.0055, 0.0055, 0.004, 24), M.sand, [0, yBase / 2, -0.012]);

// --- מכלול העדשה (קדימה = +Z) ---
const zBody = bodyD / 2;
add('lens_mount', CY(0.0295, 0.0305, 0.008, 48), M.brass, [0, yMid, zBody + 0.004], zRot);
add('lens_barrel', CY(0.026, 0.0275, 0.03, 48), M.metal, [0, yMid, zBody + 0.023], zRot);
add('focus_ring', CY(0.0288, 0.0288, 0.011, 64), M.brass, [0, yMid, zBody + 0.0165], zRot);
add('aperture_ring', CY(0.0282, 0.0282, 0.006, 64), M.sand, [0, yMid, zBody + 0.0325], zRot);
add('lens_front_ring', new THREE.TorusGeometry(0.0245, 0.0035, 20, 64), M.brass, [0, yMid, zBody + 0.0385]);
add('lens_element', CY(0.0235, 0.0245, 0.006, 64), M.glass, [0, yMid, zBody + 0.0362], zRot);
add('lens_inner_glass', new THREE.SphereGeometry(0.021, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2.6), M.glass, [0, yMid, zBody + 0.0325], [-Math.PI / 2, 0, 0]);

// --- חלונות בגוף ---
add('viewfinder_front', new THREE.BoxGeometry(0.017, 0.011, 0.004), M.glass, [-0.045, yBase + bodyH - 0.019, zBody + 0.001]);
add('rangefinder_window', new THREE.BoxGeometry(0.009, 0.009, 0.004), M.glass, [0.043, yBase + bodyH - 0.019, zBody + 0.001]);
add('self_timer_lever', new THREE.BoxGeometry(0.016, 0.0045, 0.0035), M.brass, [0.036, yMid - 0.012, zBody + 0.001], [0, 0, -0.5]);

// --- פקדים עליונים ---
const yTop = yBase + bodyH + 0.002;
add('shutter_dial', CY(0.0115, 0.0115, 0.0075, 48), M.brass, [0.038, yTop + 0.0037, -0.002]);
add('shutter_dial_face', CY(0.008, 0.008, 0.0012, 32), M.sand, [0.038, yTop + 0.008, -0.002]);
add('shutter_button', CY(0.0042, 0.0042, 0.0035, 24), M.sand, [0.024, yTop + 0.0018, 0.008]);
add('advance_lever_arm', new THREE.BoxGeometry(0.026, 0.0032, 0.008), M.brass, [0.052, yTop + 0.0016, 0.014], [0, -0.45, 0]);
add('advance_lever_tip', CY(0.005, 0.005, 0.0032, 24), M.sand, [0.064, yTop + 0.0016, 0.019]);
add('rewind_knob', CY(0.0085, 0.0105, 0.0075, 40), M.brass, [-0.05, yTop + 0.0037, -0.002]);
add('rewind_knob_top', CY(0.006, 0.0085, 0.0022, 32), M.sand, [-0.05, yTop + 0.0085, -0.002]);
add('viewfinder_hump', new THREE.BoxGeometry(0.03, 0.006, 0.026), M.brass, [-0.02, yTop + 0.003, 0.001]);
add('hot_shoe_base', new THREE.BoxGeometry(0.021, 0.0022, 0.017), M.sand, [-0.02, yTop + 0.0072, 0.001]);
add('hot_shoe_rail_a', new THREE.BoxGeometry(0.021, 0.0026, 0.0022), M.brass, [-0.02, yTop + 0.0096, 0.008]);
add('hot_shoe_rail_b', new THREE.BoxGeometry(0.021, 0.0026, 0.0022), M.brass, [-0.02, yTop + 0.0096, -0.006]);

// --- אחוריים ואביזרים ---
add('viewfinder_eyepiece', new THREE.BoxGeometry(0.014, 0.01, 0.004), M.glass, [-0.045, yBase + bodyH - 0.019, -zBody - 0.001]);
add('strap_lug_left', new THREE.TorusGeometry(0.0042, 0.0013, 12, 28), M.brass, [-bodyW / 2 - 0.0015, yBase + bodyH - 0.02, 0], [0, Math.PI / 2, 0]);
add('strap_lug_right', new THREE.TorusGeometry(0.0042, 0.0013, 12, 28), M.brass, [bodyW / 2 + 0.0015, yBase + bodyH - 0.02, 0], [0, Math.PI / 2, 0]);
add('back_door_seam', new THREE.BoxGeometry(bodyW * 0.9, 0.0016, 0.0016), M.brass, [0, yBase + 0.012, -zBody - 0.0012]);

cam.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
stage.setObject(cam);
if (shell) shell.classList.remove('is-loading');
