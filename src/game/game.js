import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const PLAYER_RADIUS = 0.55;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export class Game {
  constructor(canvas, { onScore, onGameOver }) {
    this.canvas = canvas;
    this.onScore = onScore;
    this.onGameOver = onGameOver;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e22);
    this.scene.fog = new THREE.Fog(0x0b0e22, 10, 60);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
    this.camera.position.set(0, 1, 8);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const ambient = new THREE.AmbientLight(0xc9e9ff, 0.7);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x6cffd3, 1.1);
    keyLight.position.set(5, 8, 5);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x4d5cff, 0.7);
    rimLight.position.set(-6, -4, -10);
    this.scene.add(rimLight);

    this.verticalRange = 5;
    this.controlValue = 0.5;

    this.clock = new THREE.Clock();
    this.running = false;
    this.elapsed = 0;
    this.speed = 16;
    this.spawnInterval = 1.8;
    this.spawnAccumulator = 0;
    this.difficultyTimer = 0;
    this.score = 0;

    this.player = this.createPlayer();
    this.scene.add(this.player);

    this.tunnel = this.createTunnel();
    this.scene.add(this.tunnel);

    this.obstacles = [];
    this.particlePool = [];
    this.activeParticles = [];

    this.playerSphere = new THREE.Sphere(this.player.position, PLAYER_RADIUS * 0.9);
    this.tmpBox = new THREE.Box3();

    window.addEventListener('resize', () => this.onResize());
  }

  createPlayer() {
    const geometry = new THREE.SphereGeometry(PLAYER_RADIUS, 32, 32);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x6cffd3,
      metalness: 0.4,
      roughness: 0.25,
      emissive: new THREE.Color(0x234b66),
      emissiveIntensity: 0.4,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;

    const glowGeom = new THREE.SphereGeometry(PLAYER_RADIUS * 1.4, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x6cffd3,
      transparent: true,
      opacity: 0.2,
    });
    const glow = new THREE.Mesh(glowGeom, glowMat);
    mesh.add(glow);

    mesh.position.set(0, 0, 0);
    return mesh;
  }

  createTunnel() {
    const group = new THREE.Group();
    const segmentCount = 12;
    const tunnelRadius = 6;

    for (let i = 0; i < segmentCount; i++) {
      const geometry = new THREE.TorusGeometry(tunnelRadius, 0.1, 16, 100);
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(`hsl(${220 + i * 5}, 70%, 45%)`),
        transparent: true,
        opacity: 0.25,
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = Math.PI / 2;
      ring.position.z = -i * 8;
      group.add(ring);
    }

    return group;
  }

  createObstacle(difficulty) {
    const group = new THREE.Group();
    const gapSize = THREE.MathUtils.lerp(4.2, 2.2, difficulty);
    const obstacleThickness = 2.4;
    const obstacleDepth = 4;

    const materialTop = new THREE.MeshStandardMaterial({ color: 0xff758c, metalness: 0.3, roughness: 0.5, emissive: 0x361020 });
    const materialBottom = new THREE.MeshStandardMaterial({ color: 0x4d5cff, metalness: 0.3, roughness: 0.45, emissive: 0x151226 });

    const topHeight = 8;
    const bottomHeight = 8;

    const topGeometry = new THREE.BoxGeometry(obstacleThickness, topHeight, obstacleDepth);
    const bottomGeometry = new THREE.BoxGeometry(obstacleThickness, bottomHeight, obstacleDepth);

    const top = new THREE.Mesh(topGeometry, materialTop);
    const bottom = new THREE.Mesh(bottomGeometry, materialBottom);

    const offsetY = THREE.MathUtils.lerp(-1.2, 1.2, Math.random());

    top.position.set(0, gapSize / 2 + topHeight / 2 + offsetY, 0);
    bottom.position.set(0, -(gapSize / 2 + bottomHeight / 2) + offsetY, 0);

    top.castShadow = bottom.castShadow = true;
    top.receiveShadow = bottom.receiveShadow = true;

    group.add(top);
    group.add(bottom);

    group.position.set(0, 0, -70);
    group.userData = {
      top,
      bottom,
      passed: false,
    };

    return group;
  }

  setControlValue(value) {
    this.controlValue = THREE.MathUtils.clamp(value, 0, 1);
  }

  start() {
    this.reset();
    this.running = true;
    this.clock.start();
    this.animate();
  }

  stop() {
    this.running = false;
  }

  reset() {
    this.elapsed = 0;
    this.spawnAccumulator = 0;
    this.difficultyTimer = 0;
    this.spawnInterval = 1.8;
    this.speed = 16;
    this.score = 0;
    this.controlValue = 0.5;

    this.player.position.set(0, 0, 0);
    this.playerSphere.radius = PLAYER_RADIUS * 0.9;

    for (const obstacle of this.obstacles) {
      this.scene.remove(obstacle);
    }
    this.obstacles.length = 0;

    for (const particle of this.activeParticles) {
      this.scene.remove(particle);
    }
    this.activeParticles.length = 0;

    if (this.onScore) {
      this.onScore(this.score);
    }
  }

  animate() {
    if (!this.running) return;

    requestAnimationFrame(() => this.animate());

    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += delta;
    this.spawnAccumulator += delta;
    this.difficultyTimer += delta;

    const difficultyFactor = THREE.MathUtils.clamp(this.difficultyTimer / 120, 0, 1);
    this.speed = THREE.MathUtils.lerp(16, 26, easeOutExpo(difficultyFactor));
    this.spawnInterval = THREE.MathUtils.lerp(1.8, 1, easeOutExpo(difficultyFactor));

    const targetY = THREE.MathUtils.lerp(-this.verticalRange / 2, this.verticalRange / 2, this.controlValue);
    this.player.position.y = lerp(this.player.position.y, targetY, 0.12 + difficultyFactor * 0.1);
    this.player.rotation.z = lerp(this.player.rotation.z, (this.controlValue - 0.5) * 0.6, 0.2);

    this.updateTunnel(delta);
    this.updateObstacles(delta, difficultyFactor);
    this.updateParticles(delta);

    this.renderer.render(this.scene, this.camera);
  }

  updateTunnel(delta) {
    this.tunnel.children.forEach((ring) => {
      ring.position.z += delta * this.speed * 0.8;
      if (ring.position.z > 4) {
        ring.position.z = -88;
      }
    });
  }

  updateObstacles(delta, difficulty) {
    if (this.spawnAccumulator >= this.spawnInterval) {
      this.spawnAccumulator = 0;
      const obstacle = this.createObstacle(difficulty);
      this.scene.add(obstacle);
      this.obstacles.push(obstacle);
    }

    const playerZ = this.player.position.z;
    this.playerSphere.center.copy(this.player.position);

    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obstacle = this.obstacles[i];
      obstacle.position.z += this.speed * delta;

      const { top, bottom, passed } = obstacle.userData;

      if (!passed && obstacle.position.z > playerZ + PLAYER_RADIUS) {
        obstacle.userData.passed = true;
        this.addScore(1);
        this.spawnParticles(obstacle.position.clone(), 0xff758c);
      }

      if (obstacle.position.z > 10) {
        this.scene.remove(obstacle);
        this.obstacles.splice(i, 1);
        continue;
      }

      this.tmpBox.setFromObject(top);
      if (this.tmpBox.intersectsSphere(this.playerSphere)) {
        this.gameOver();
        return;
      }
      this.tmpBox.setFromObject(bottom);
      if (this.tmpBox.intersectsSphere(this.playerSphere)) {
        this.gameOver();
        return;
      }
    }
  }

  spawnParticles(position, color) {
    const count = 12;
    for (let i = 0; i < count; i++) {
      const particle = this.getParticle(color);
      particle.position.copy(position);
      particle.position.x += (Math.random() - 0.5) * 1.2;
      particle.position.y += (Math.random() - 0.5) * 1.2;
      particle.position.z += (Math.random() - 0.5) * 1.2;
      particle.userData.life = 0.6 + Math.random() * 0.4;
      particle.userData.velocity.set((Math.random() - 0.5) * 6, Math.random() * 6, (Math.random() - 0.5) * 6);
      this.scene.add(particle);
      this.activeParticles.push(particle);
    }
  }

  getParticle(color) {
    let particle = this.particlePool.pop();
    if (!particle) {
      const geometry = new THREE.SphereGeometry(0.12, 8, 8);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
      particle = new THREE.Mesh(geometry, material);
      particle.userData.velocity = new THREE.Vector3();
    } else {
      particle.material.color.set(color);
      particle.material.opacity = 0.8;
    }
    return particle;
  }

  updateParticles(delta) {
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const particle = this.activeParticles[i];
      particle.userData.life -= delta;
      particle.position.addScaledVector(particle.userData.velocity, delta);
      particle.material.opacity = Math.max(0, particle.userData.life * 1.5);

      if (particle.userData.life <= 0) {
        this.scene.remove(particle);
        this.activeParticles.splice(i, 1);
        this.particlePool.push(particle);
      }
    }
  }

  addScore(amount) {
    this.score += amount;
    if (this.onScore) {
      this.onScore(Math.floor(this.score));
    }
  }

  gameOver() {
    this.running = false;
    if (this.onGameOver) {
      this.onGameOver(Math.floor(this.score));
    }
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}
