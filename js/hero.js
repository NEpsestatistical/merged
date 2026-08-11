// ---------- hero 3D boom-zoom scene (Three.js) ----------
// A cinematic wireframe/particle field that booms in from deep space on load,
// then settles into a slow ambient drift with gentle scroll-parallax.
(function(){
  const canvas = document.getElementById("hero-bg-canvas");
  if(!canvas || !window.THREE) return;
  if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const hero = canvas.closest(".home-hero");
  let w = hero.clientWidth, h = hero.clientHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.setSize(w, h, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0a0c, 0.0125);

  const camera = new THREE.PerspectiveCamera(55, w/h, 0.1, 2000);
  camera.position.set(0, 0, 900); // starts far out — this is the "boom" launch point

  // ----- gold/ember particle field -----
  const PARTICLE_COUNT = 1400;
  const positions = new Float32Array(PARTICLE_COUNT*3);
  const seeds = new Float32Array(PARTICLE_COUNT);
  for(let i=0;i<PARTICLE_COUNT;i++){
    const r = 60 + Math.random()*260;
    const theta = Math.random()*Math.PI*2;
    const phi = Math.acos((Math.random()*2)-1);
    positions[i*3]   = r*Math.sin(phi)*Math.cos(theta);
    positions[i*3+1] = r*Math.sin(phi)*Math.sin(theta)*0.6;
    positions[i*3+2] = r*Math.cos(phi);
    seeds[i] = Math.random()*Math.PI*2;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xFF8A3D, size: 2.4, transparent:true, opacity:0.85,
    blending: THREE.AdditiveBlending, depthWrite:false, sizeAttenuation:true
  });
  const particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);

  // ----- rotating wireframe polyhedra (the "logo energy" echoing the EE cube) -----
  const shapes = [];
  const shapeDefs = [
    { geo:new THREE.IcosahedronGeometry(70, 0), color:0xFF5A1F, pos:[-160, 40, -120] },
    { geo:new THREE.OctahedronGeometry(50, 0),  color:0xFF8A3D, pos:[190, -60, -200] },
    { geo:new THREE.TetrahedronGeometry(46, 0), color:0xFFC08A, pos:[40, 110, -260] }
  ];
  shapeDefs.forEach(def=>{
    const mat = new THREE.MeshBasicMaterial({ color: def.color, wireframe:true, transparent:true, opacity:0.55 });
    const mesh = new THREE.Mesh(def.geo, mat);
    mesh.position.set(...def.pos);
    mesh.userData.spin = { x:(Math.random()-0.5)*0.006, y:(Math.random()-0.5)*0.008 };
    scene.add(mesh);
    shapes.push(mesh);
  });

  // ----- faint horizon grid for depth -----
  const grid = new THREE.GridHelper(1400, 28, 0xFF5A1F, 0x2A2A30);
  grid.position.y = -180;
  grid.material.transparent = true;
  grid.material.opacity = 0.12;
  scene.add(grid);

  // ----- boom-zoom intro: camera rushes in from 900 -> 340, then eases to rest -----
  const START_Z = 900, REST_Z = 340;
  let t0 = performance.now();
  const BOOM_MS = 2200;
  function easeOutExpo(x){ return x===1 ? 1 : 1 - Math.pow(2,-10*x); }

  let scrollY = 0;
  window.addEventListener("scroll", ()=>{ scrollY = window.scrollY; }, { passive:true });

  let raf;
  function animate(now){
    raf = requestAnimationFrame(animate);
    const elapsed = now - t0;
    const boomT = Math.min(elapsed / BOOM_MS, 1);
    const eased = easeOutExpo(boomT);
    camera.position.z = START_Z + (REST_Z - START_Z) * eased;
    camera.fov = 70 - (70-55)*eased;
    camera.updateProjectionMatrix();

    const drift = now * 0.00006;
    particles.rotation.y = drift;
    particles.rotation.x = Math.sin(now*0.00003)*0.08;

    shapes.forEach(s=>{ s.rotation.x += s.userData.spin.x; s.rotation.y += s.userData.spin.y; });

    // subtle parallax as the hero scrolls out of view
    const parallax = Math.min(scrollY, h) * 0.35;
    scene.position.y = -parallax*0.15;
    camera.position.y = parallax*0.05;

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(animate);

  function onResize(){
    w = hero.clientWidth; h = hero.clientHeight;
    if(!w || !h) return;
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener("resize", onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(hero);

  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden){ cancelAnimationFrame(raf); } else { raf = requestAnimationFrame(animate); }
  });
})();

// ---------- editorial scroll-reveal ----------
// Fades/slides in cards and sections as they enter the viewport, the way STILL.'s
// site reveals sections on scroll. Auto-tags common content blocks with .reveal,
// then watches for anything new (feed cards, people, news, etc. render dynamically).
(function(){
  const REVEAL_SELECTORS = ".post-card, .person-card, .news-card, .trend-row, .home-section, .wl-card, .person-row";
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){ entry.target.classList.add("in"); io.unobserve(entry.target); }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

  function tag(root){
    root.querySelectorAll(REVEAL_SELECTORS).forEach(el=>{
      if(el.dataset.revealed) return;
      el.dataset.revealed = "1";
      el.classList.add("reveal");
      io.observe(el);
    });
  }
  tag(document);

  const mo = new MutationObserver((mutations)=>{
    mutations.forEach(m=>{
      m.addedNodes.forEach(node=>{
        if(node.nodeType === 1) tag(node.matches?.(REVEAL_SELECTORS) ? node.parentElement || document : node);
      });
    });
  });
  mo.observe(document.body, { childList:true, subtree:true });
})();
