// ==UserScript==
// @name             Krunker ESP + Aimbot — WASD
// @namespace        krunker-esp-aimbot
// @version          2.0.0
// @description      Krunker.io ESP + Aimbot + No-Recoil + Bhop + Speed
// @author           WASD (extracted)
// @match            *://krunker.io/*
// @match            *://browserfps.com/*
// @match            *://*.browserfps.com/*
// @exclude          *://krunker.io/social*
// @exclude          *://krunker.io/editor*
// @exclude          *://krunker.io/viewer*
// @grant            unsafeWindow
// @run-at           document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  const S = {
    espSquare:         true,
    espBoxStyle:       'corners',
    espLines:          true,
    espTeamCheck:      true,
    espBotCheck:       true,
    espWallCheck:      true,
    espColor:          '#ff4545',
    boxColor:          '#a9dcff',
    botColor:          '#ffb700',
    espUseTheme:       true,
    espHealthBar:      true,
    healthBarWidth:    4,
    healthBarShadow:   true,
    healthBarUseTheme: true,
    espNameTags:       true,
    espInfoBackground: true,
    espBones:          true,
    espGlow:           true,
    espGlowIntensity:  18,

    drawFovCircle:     true,
    fovSize:           400,

    aimbotEnabled:     true,
    aimbotKey:         'always',
    aimbotTeamCheck:   true,
    aimbotBotCheck:    true,
    aimbotWallCheck:   true,
    legitAimbot:       true,
    flickSpeed:        25,
    aimSmoothing:      0.10,
    aimHeadshot:       true,
    aimOffset:         0,

    autoFireEnabled:   true,
    autoReloadEnabled: true,
    noRecoilEnabled:   false,
    bhopEnabled:       true,
    speedEnabled:      false,
    speedMultiplier:   1.3,
    antiKick:          true,

    thirdPersonEnabled: true,
    thirdPersonDist:    5,
    thirdPersonHeight:  1.5,

    antiBotEnabled:    false,

    themePrimary:      '#ffb7d5',
    themeSecondary:    '#a9dcff',
    themeMidpoint:     '#c8beff',
  };

  const pageWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  const fromPage   = obj => obj?.wrappedJSObject ?? obj;
  const toPageFn   = fn  => (typeof exportFunction === 'function') ? exportFunction(fn, pageWindow) : fn;

  class KrunkerCheat {
    constructor() {
      this.game      = null;
      this.me        = null;
      this.renderer  = null;
      this.controls  = null;
      this.ctx       = null;
      this.three     = null;
      this.scale     = 1;

      this.tempVector = null;
      this.cameraPos  = null;
      this.vec2       = null;
      this.rayC       = null;

      this.failedHooks      = new Set();
      this.hookedPlayers    = new WeakSet();
      this.hookStats        = { frames: 0, inputs: 0, unmatchedClears: 0 };
      this.hooksInitialized = false;
      this.framePending     = false;
      this.overlayBridge    = null;
      this.detachOverlay    = null;
      this.inputMethodName  = null;

      this.skeletonCache = new WeakMap();

      this.PLAYER_HEIGHT    = 11;
      this.PLAYER_WIDTH     = 4;
      this.CROUCH_FACTOR    = 3;
      this.BOT_CROUCH_FACTOR= 2;
      this.CAMERA_HEIGHT    = 1.5;

      this.aimTarget             = null;
      this.aimStatus             = '';
      this.rightMouseDown        = false;
      this.leftMouseDown         = false;
      this.inputMethodName       = null;
      this.inputDiscoveryAttempt = null;
      this._slotCache            = null;
      this.vars = { pchObjc: 'pchObjc', xdir: 2, ydir: 3, scope: 4, shoot: 5, jump: 6 };

      this._origCamParent        = null;
      this._tpOffset             = null;

      document.addEventListener('mousedown', e => {
        if (e.button === 2) this.rightMouseDown = true;
        if (e.button === 0) this.leftMouseDown  = true;
      }, true);
      document.addEventListener('mouseup', e => {
        if (e.button === 2) this.rightMouseDown = false;
        if (e.button === 0) this.leftMouseDown  = false;
      }, true);
      this.pressedKeys = new Set();
      document.addEventListener('keydown', e => this.pressedKeys.add(e.code), true);
      document.addEventListener('keyup',   e => this.pressedKeys.delete(e.code), true);
    }

    isTeam(e) {
      return this.me?.team != null && this.me.team === e.team;
    }

    isRoundEnded() {
      return this.game?.roundOver === true;
    }

    isGameplayAllowed() {
      if (!this.me) return false;
      if (this.isRoundEnded()) return false;
      if (this.me.active === false) return false;
      if (Number.isFinite(this.me.health) && this.me.health <= 0) return false;
      return true;
    }

    runHook(name, fn) {
      if (this.failedHooks.has(name)) return;
      try { return fn(); }
      catch (e) {
        this.failedHooks.add(name);
        console.warn(`🌸 WASD: hook '${name}' disabled —`, e?.message || e);
      }
    }

    espPalette(isBot = false) {
      return {
        primary:   isBot ? S.botColor : (S.espUseTheme ? S.themePrimary   : S.espColor),
        secondary: S.espUseTheme ? S.themeSecondary : S.boxColor,
      };
    }

    predictionField(obj, key, type) {
      try {
        const d = Object.getOwnPropertyDescriptor(obj, key);
        if (!d?.writable || typeof d.value !== type) return null;
        if (type === 'number' && !Number.isFinite(d.value)) return null;
        return d;
      } catch { return null; }
    }

    initializeGameHooks() {
      if (this.hooksInitialized) return;
      const pw  = pageWindow;
      const cvs = pw.document.getElementById('game-overlay');
      const ctx = fromPage(cvs?.getContext('2d'));
      if (!ctx || typeof ctx.clearRect !== 'function') throw new Error('overlay canvas yok');

      const origDesc  = Object.getOwnPropertyDescriptor(ctx, 'clearRect');
      const origFn    = ctx.clearRect;
      const observeFn = toPageFn(args => this.runHook('capture', () => this.captureFrame(fromPage(args))));

      const bridgeFn = pw.Function('nativeClearRect', 'observe',
        'var state={clears:0,callerVisible:false,error:null};' +
        'function wasdClearRect(){' +
        '  var r=Reflect.apply(nativeClearRect,this,arguments);state.clears++;' +
        '  try{var f=wasdClearRect.caller;state.callerVisible=!!f;observe(f&&f.arguments);}' +
        '  catch(e){state.error=String(e&&e.message||e);}' +
        '  return r;}' +
        'wasdClearRect.diagnostics=state;return wasdClearRect;'
      );
      const bridge = bridgeFn(origFn, observeFn);

      Object.defineProperty(ctx, 'clearRect', { value: bridge, writable: true, configurable: true, enumerable: false });
      this.detachOverlay = () => {
        if (ctx.clearRect !== bridge) return;
        if (origDesc) Object.defineProperty(ctx, 'clearRect', origDesc);
        else delete ctx.clearRect;
      };

      this.ctx = ctx;
      this.hooksInitialized = true;
    }

    captureFrame(args) {
      if (!args) return;
      const game = fromPage(args[1]);
      if (!Number.isFinite(args[0]) || !Array.isArray(game?.players?.list)) {
        if (++this.hookStats.unmatchedClears >= 120) {
          this.detachOverlay?.();
          console.warn('🌸 WASD: render signature değişti, detach.');
        }
        return;
      }

      this.scale    = args[0];
      this.game     = game;
      this.controls = fromPage(args[2]);
      this.renderer = fromPage(args[3]);

      const directMe = fromPage(args[4]);
      if (!directMe) {
        const found = game.players.list.map(p => fromPage(p)).filter(p => p?.isYou === true && !p.isBot);
        this.me = found.length === 1 ? found[0] : null;
      } else {
        this.me = directMe;
      }

      this.hookStats.frames++;

      if (!this.three) {
        const THREE = fromPage(game.THREE || this.renderer.THREE);
        if (typeof THREE?.Vector3 !== 'function') return;
        this.three      = THREE;
        this.tempVector = new THREE.Vector3();
        this.cameraPos  = new THREE.Vector3();
        this.vec2       = new THREE.Vector2(0, 0);
        this.rayC       = new THREE.Raycaster();
      }

      if (!this.me) return;
      if (this.framePending) return;
      if (this._lastMe !== this.me) {
        this._slotCache = null;
        this._lastMe = this.me;
        this.hookedPlayers = new WeakSet();
      }
      this.framePending = true;

      queueMicrotask(() => {
        this.framePending = false;
        this.runHook('input-install', () => this.installInputHook());
        this.runHook('render',        () => this.onRenderFrame());
      });
    }

    findInputMethod(player) {
      if (!player) return null;
      const p = player?.wrappedJSObject ?? player;
      const map = new Map();

      for (let obj = p, depth = 0; obj && depth < 5; obj = Object.getPrototypeOf(obj), depth++) {
        let descs;
        try { descs = Object.getOwnPropertyDescriptors(obj); } catch { continue; }
        for (const [k, d] of Object.entries(descs)) {
          if (!map.has(k) && typeof d.value === 'function') map.set(k, d.value);
        }
      }

      console.log('🌸 WASD: toplam metod sayısı =', map.size,
        '| ilk 30:', [...map.keys()].slice(0, 30).join(', '));

      const byMoveLock = new Set();
      const byInputSig  = new Set();

      for (const [name, fn] of map) {
        let src;
        try { src = Function.prototype.toString.call(fn); } catch { continue; }

        if (src.includes('moveLock')) {
          const re = /this\[['"]([^'"]+)['"]\]\s*\(\s*this\[[^\]]+\]\[[^\]]+\],[^;{}]{0,800}?\[['"]moveLock['"]\]\s*\)/g;
          for (const m of src.matchAll(re)) {
            if (map.has(m[1])) byMoveLock.add(m[1]);
          }
        }

        const firstParam = src.match(/^[^(]*\(\s*([\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*)/u)?.[1];
        if (!firstParam) continue;
        const esc  = firstParam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const slot = n => esc + '\\s*\\[\\s*(?:0[xX]' + n + '|' + n + ')\\s*\\]';
        const hasFloat = n => new RegExp(
          'parseFloat\\s*\\(\\s*' + slot(n) +
          '\\s*(?:\\|\\|\\s*(?:0|0))?\\s*\\)\\s*(?:\\|\\|\\s*(?:0|0)\\s*\\))?\\s*\\/\\s*(?:0[xX]3[eE]8|1000)\\b'
        ).test(src);
        const hasSlots = [0,1,4,5,6].every(n => new RegExp(slot(n)).test(src));
        if (hasFloat(2) && hasFloat(3) && (hasSlots || /(?:noclip|recon|inputSN)/.test(src))) {
          byInputSig.add(name);
        }
      }

      if (byMoveLock.size === 1) return [...byMoveLock][0];
      if (byMoveLock.size  > 1) return null;
      if (byInputSig.size === 1) return [...byInputSig][0];
      if (byInputSig.size  > 1) return null;

      for (const [name, fn] of map) {
        let src;
        try { src = Function.prototype.toString.call(fn); } catch { continue; }
        const paramCount = (src.match(/^function\s*\w*\s*\(([^)]*)\)/)?.[1] || '').split(',').filter(Boolean).length;
        if (paramCount === 4 && src.includes("'recon'")) return name;
      }

      for (const [name, fn] of map) {
        let src;
        try { src = Function.prototype.toString.call(fn); } catch { continue; }
        if (src.includes("'recon'") && !name.includes('reset')) return name;
      }

      return map.has('procInputs') ? 'procInputs' : null;
    }

    installInputHook() {
      if (!this.me) return;

      const rawMe = this.me?.wrappedJSObject ?? this.me;

      if (this.hookedPlayers.has(rawMe)) return;

      if (this.inputDiscoveryAttempt?.player === rawMe &&
          Date.now() - this.inputDiscoveryAttempt.at < 2000) return;
      this.inputDiscoveryAttempt = { player: rawMe, at: Date.now() };

      const methodName = this.findInputMethod(rawMe);
      if (!methodName) return;

      const originalFn = rawMe[methodName];
      const self = this;

      rawMe[methodName] = toPageFn(function (...args) {
        try {
          self.hookStats.inputs++;
          if (!self.failedHooks.has('inputs')) {
            const packet = fromPage(args[0]);
            const backup = Array.isArray(packet) ? Array.from(packet) : null;

            if (args[2] !== true && self.isGameplayAllowed()) {
              self.runHook('inputs', () => self.onProcessInputs(packet, fromPage(this)));
            }

            if (backup && self.failedHooks.has('inputs')) {
              for (let i = 0; i < backup.length; i++) {
                if (!Object.is(packet[i], backup[i])) packet[i] = backup[i];
              }
              if (packet.length !== backup.length) packet.length = backup.length;
            }
          }
        } catch (e) {
          self.failedHooks.add('inputs');
          console.warn('🌸 WASD: inputs hook çöktü', e);
        }

        const result = Reflect.apply(originalFn, fromPage(this), args);

        if (S.noRecoilEnabled && self.me) {
          try {
            const me = fromPage(self.me);
            me.noRecoil = true;
            me.recoilForce = 0;
            me.recoilAnim = 0;
            me.recoilAnimY = 0;
            if (me.weapon) {
              me.weapon.noSpread = true;
              me.weapon.spread = 0;
            }
            me.spread = 0;
            me.spreadMlt = 0;
          } catch {}
        }

        return result;
      });

      this.hookedPlayers.add(rawMe);
      this.inputMethodName = methodName;
      console.log('🌸 WASD: input hooked →', methodName);
    }

    onProcessInputs(packet, player) {
      if (!packet || !Array.isArray(packet) || !this.me || !this.controls) return;

      const xdir = 2;
      const ydir = 3;
      const jump = 6;

      if (S.antiKick) {
        try { if (this.controls.idleTimer != null) this.controls.idleTimer = 0; } catch {}
      }

      if (S.bhopEnabled && this.controls?.binds?.jump && this.pressedKeys?.has('Space')) {
        try {
          const jumpKey   = this.controls.binds.jump.val;
          const crouchKey = this.controls.binds.crouch?.val;

          this.controls.keys[jumpKey] ^= 1;
          if (this.controls.keys[jumpKey]) {
            this.controls.didPressed[jumpKey] = 1;
          }

          if (crouchKey != null && this.me.velocity?.y < -0.03 && this.me.canSlide) {
            this.controls.keys[crouchKey]    = 1;
            this.controls.didPressed[crouchKey] = 1;
            setTimeout(() => {
              if (this.controls?.keys) this.controls.keys[crouchKey] = 0;
            }, this.me.slideTimer || 325);
          }
        } catch {}
      }

      if (S.autoReloadEnabled) {
        try {
          const me = fromPage(this.me);
          if (me && me.weapon && me.reloadTimer === 0 && !me.weapon.noReload) {
            const wi = me.loadoutIndex ?? 0;
            const ammos = me.ammos;
            if (Array.isArray(ammos) && ammos[wi] === 0) {
              packet[8] = 1;
            }
          }
        } catch {}
      }

      if (S.noRecoilEnabled) {
        try {
          const me = fromPage(this.me);
          me.noRecoil = true;
          me.recoilForce = 0;
          me.recoilAnim = 0;
          me.recoilAnimY = 0;
        } catch {}
      }

      if (S.antiBotEnabled) {
        const keyOk = S.aimbotEnabled && (
          S.aimbotKey === 'always'
          || (S.aimbotKey === 'mouse2' && this.rightMouseDown)
          || (S.aimbotKey === 'mouse1' && this.leftMouseDown)
        );
        if (!keyOk) {
          packet[xdir] = -1570;
          return;
        }
      }

      if (!S.aimbotEnabled) return;

      const keyOk = S.aimbotKey === 'always'
        || (S.aimbotKey === 'mouse2' && this.rightMouseDown)
        || (S.aimbotKey === 'mouse1' && this.leftMouseDown);
      if (!keyOk) { this.aimTarget = null; return; }

      const pchKey   = 'pchObjc';
      const curYaw   = Number.isFinite(this.controls.object?.rotation?.y)
        ? this.controls.object.rotation.y
        : (packet[ydir] ?? 0) / 1000;
      const curPitch = Number.isFinite(this.controls[pchKey]?.rotation?.x)
        ? this.controls[pchKey].rotation.x
        : (packet[xdir] ?? 0) / 1000;

      const target = this.findBestTarget(curYaw, curPitch);
      if (!target) { this.aimTarget = null; this.aimStatus = 'no target'; return; }
      this.aimTarget = target;

      const angles = this.getAimAngles(target);
      if (!Number.isFinite(angles.yaw + angles.pitch)) return;

      let tYaw   = angles.yaw;
      let tPitch = angles.pitch - (0.3 * (fromPage(this.me).recoilAnimY || 0));

      if (S.legitAimbot) {
        const smooth = Math.max(0.02, Math.min(0.95, S.flickSpeed / 100));
        let dy = tYaw   - curYaw;
        let dp = tPitch - curPitch;
        while (dy >  Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        tYaw   = curYaw   + dy * smooth;
        tPitch = curPitch + dp * smooth;
      }

      packet[xdir] = Math.round(tPitch * 1000);
      packet[ydir] = Math.round(tYaw   * 1000);

      try {
        if (this.controls.object) this.controls.object.rotation.y = tYaw;
        if (this.controls.pchObjc) this.controls.pchObjc.rotation.x = tPitch;
      } catch {}
      this.aimStatus = 'aim applied';

      if (S.autoFireEnabled && this.aimTarget) {
        try {
          const me = fromPage(this.me);
          if (me.reloadTimer === 0 && !me.didShoot) {
            const shootSlot = 5;
            const scopeSlot = 6;
            const weapon = me.weapon;
            if (weapon?.noAim) {
              packet[shootSlot] = 1;
            } else {
              packet[scopeSlot] = 1;
              if (me.aimVal === 0) {
                packet[shootSlot] = 1;
              }
            }
          }
        } catch {}
      }
    }

    findBestTarget(curYaw, curPitch) {
      if (!this.game?.players?.list || !this.me) return null;

      const fovRad = S.fovSize * Math.PI / 180;
      const cam    = this.renderer?.camera;
      if (!cam) return null;

      let best     = null;
      let bestDist = Infinity;

      const candidates = [
        ...this.game.players.list.map(p => ({ e: fromPage(p), isBot: false })),
        ...(S.aimbotBotCheck ? (this.game.AI?.ais || []).map(b => ({ e: fromPage(b), isBot: true })) : []),
      ];

      for (const { e, isBot } of candidates) {
        if (!e || e.isYou || !e.active) continue;
        if (!isBot && !e.objInstances) continue;
        if (!isBot && S.aimbotTeamCheck && this.isTeam(e)) continue;
        if (Number.isFinite(e.health) && e.health <= 0) continue;

        const angles = this.getAimAngles(e);
        if (!Number.isFinite(angles.yaw + angles.pitch)) continue;

        let dy = angles.yaw   - curYaw;
        let dp = angles.pitch - curPitch;
        while (dy >  Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        const angDist = Math.sqrt(dy * dy + dp * dp);
        if (angDist > fovRad) continue;

        if (S.aimbotWallCheck) {
          if (!this._aimVisCache) this._aimVisCache = new WeakMap();
          const cached = this._aimVisCache.get(e);
          let visible;
          if (cached && cached.frame > this.hookStats.frames - 8) {
            visible = cached.value;
          } else {
            visible = this.getCanSee(e);
            this._aimVisCache.set(e, { frame: this.hookStats.frames, value: visible });
          }
          if (!visible) continue;
        }

        if (angDist < bestDist) {
          bestDist = angDist;
          best = e;
        }
      }

      return best;
    }

    getAimAngles(entity) {
      const mx = this.me.x, mz = this.me.z;
      const myHeight = Number.isFinite(this.me.height) ? this.me.height : this.PLAYER_HEIGHT;
      const myEyeY = this.me.y + myHeight - this.CAMERA_HEIGHT;

      const tx = entity.x ?? 0;
      const tz = entity.z ?? 0;
      const ty = entity.y ?? 0;

      const targetH = Number.isFinite(entity.height) ? entity.height : this.PLAYER_HEIGHT;
      const crouchV = Math.max(0, Math.min(1, Number(entity.crouchVal ?? entity.cV ?? 0)));
      const actualH = targetH - this.CROUCH_FACTOR * crouchV;
      const targetY = S.aimHeadshot
        ? ty + actualH - 1.0 + (Number(S.aimOffset) || 0)
        : ty + actualH * 0.6 + (Number(S.aimOffset) || 0);

      const yaw   = Math.atan2(-(tx - mx), -(tz - mz));
      const hDist = Math.sqrt((tx - mx) ** 2 + (tz - mz) ** 2);
      const pitch = Math.atan2(targetY - myEyeY, Math.max(0.01, hDist));

      return { yaw, pitch };
    }

    getDistanceSq(a, b) {
      const dx = (a.x ?? 0) - (b.x ?? 0);
      const dy = (a.y ?? 0) - (b.y ?? 0);
      const dz = (a.z ?? 0) - (b.z ?? 0);
      return dx * dx + dy * dy + dz * dz;
    }

    updateThirdPerson() {
      const config = fromPage(this.game?.config);

      if (this._tpOverride && this._tpOverride.config !== config) {
        this.restoreThirdPerson();
      }

      const desc = config && Object.getOwnPropertyDescriptor(config, 'thirdPerson');
      if (!desc || typeof desc.value !== 'boolean' || !desc.writable) return;

      if (S.thirdPersonEnabled) {
        this._tpOverride = this._tpOverride || {
          config:   config,
          original: config.thirdPerson,
          player:   null,
        };

        const needsRefresh = config.thirdPerson !== true
          || this._tpOverride.player !== this.me;

        config.thirdPerson = true;
        this._tpOverride.player = this.me;

        if (needsRefresh) {
          try {
            const rawMe = fromPage(this.me);
            if (rawMe && typeof rawMe === 'object' && rawMe.active !== false) {
              const nd = Object.getOwnPropertyDescriptor(rawMe, 'needsRender');
              if (!nd) {
                if (Object.isExtensible(rawMe))
                  Object.defineProperty(rawMe, 'needsRender', { value: true, writable: true, configurable: true, enumerable: true });
              } else if (nd.writable) {
                rawMe.needsRender = true;
              }
            }
          } catch {}
        }
      } else {
        this.restoreThirdPerson();
      }
    }

    restoreThirdPerson() {
      const ov = this._tpOverride;
      if (!ov) return;
      if (ov.config.thirdPerson === true) ov.config.thirdPerson = ov.original;
      try {
        const rawMe = fromPage(ov.player);
        if (rawMe && typeof rawMe === 'object') {
          const nd = Object.getOwnPropertyDescriptor(rawMe, 'needsRender');
          if (nd?.writable) rawMe.needsRender = true;
        }
      } catch {}
      this._tpOverride = null;
    }

    getDirection(x1, y1, x2, y2) {
      return Math.atan2(y2 - y1, x2 - x1);
    }

    getCanSee(player, boxSize) {
      const from = this.me;
      if (!from || !this.game?.map?.manager?.objects) return true;
      boxSize = boxSize || 0;

      const toX = player.x ?? 0;
      const toZ = player.z ?? 0;
      const tH   = Number.isFinite(player.height) ? player.height : this.PLAYER_HEIGHT;
      const crV  = Math.max(0, Math.min(1, Number(player.crouchVal ?? player.cV ?? 0)));
      const toY  = (player.y ?? 0) + (tH - this.CROUCH_FACTOR * crV) * 0.75;

      const fromY = from.y + (Number.isFinite(from.height) ? from.height : this.PLAYER_HEIGHT) - this.CAMERA_HEIGHT;

      const dist = Math.sqrt((toX-from.x)**2 + (toY-fromY)**2 + (toZ-from.z)**2);
      if (dist < 0.1) return true;

      const xDr = this.getDirection(from.z, from.x, toZ, toX);
      const yDr = this.getDirection(Math.sqrt((toX-from.x)**2 + (toZ-from.z)**2), toY, 0, fromY);
      const dx = 1 / (dist * Math.sin(xDr - Math.PI) * Math.cos(yDr));
      const dz = 1 / (dist * Math.cos(xDr - Math.PI) * Math.cos(yDr));
      const dy = 1 / (dist * Math.sin(yDr));

      let penetrableWallsHit = 0;

      for (let i = 0; i < this.game.map.manager.objects.length; ++i) {
        const obj = this.game.map.manager.objects[i];

        if (!obj.active) continue;
        if (obj.noShoot) continue;
        if (obj.transparent) continue;

        const bx = Math.max(0, (obj.width  ?? 0) - boxSize);
        const by = Math.max(0, (obj.height ?? 0) - boxSize);
        const bz = Math.max(0, (obj.length ?? 0) - boxSize);

        const tmpDst = this.lineInRect(
          from.x, from.z, fromY, dx, dz, dy,
          obj.x - bx, obj.z - bz, obj.y - by,
          obj.x + bx, obj.z + bz, obj.y + by
        );

        if (tmpDst !== false && tmpDst > 0 && tmpDst < 1) {
          if (obj.penetrable) {
            penetrableWallsHit++;
            if (penetrableWallsHit > 1) return false;
          } else {
            return false;
          }
        }
      }

      return true;
    }

    lineInRect(lx1, lz1, ly1, dx, dz, dy, x1, z1, y1, x2, z2, y2) {
      const t1 = (x1-lx1)*dx; const t2 = (x2-lx1)*dx;
      const t3 = (y1-ly1)*dy; const t4 = (y2-ly1)*dy;
      const t5 = (z1-lz1)*dz; const t6 = (z2-lz1)*dz;
      const tmin = Math.max(Math.max(Math.min(t1,t2),Math.min(t3,t4)),Math.min(t5,t6));
      const tmax = Math.min(Math.min(Math.max(t1,t2),Math.max(t3,t4)),Math.max(t5,t6));
      if (tmax < 0) return false;
      if (tmin > tmax) return false;
      return tmin;
    }

    onRenderFrame() {
      if (!this.isGameplayAllowed()) return;
      if (!this.three || !this.renderer?.camera || !this.me || !this.game?.players?.list) return;

      if (S.antiKick && this.controls?.idleTimer != null) {
        try { this.controls.idleTimer = 0; } catch {}
      }

      if (S.noRecoilEnabled && this.me) {
        try {
          const me = fromPage(this.me);
          if (me.noRecoil === false) me.noRecoil = true;
          me.recoilForce = 0;
          me.recoilAnim = 0;
          me.recoilAnimY = 0;
          const w = me.weapon;
          if (w) {
            if (w.noSpread === false) w.noSpread = true;
            if (w.spread !== undefined) w.spread = 0;
          }
          if (me.spread !== undefined) me.spread = 0;
          if (me.spreadMlt !== undefined) me.spreadMlt = 0;
        } catch {}
      }

      this.runHook('third-person', () => this.updateThirdPerson());
      try {
        this.runHook('fov',         () => this.drawFov());
        this.runHook('esp-players', () => {
          for (const raw of this.game.players.list) {
            const p = fromPage(raw);
            if (!p || p.isYou || !p.active || !p.objInstances) continue;
            this.drawCanvasESP(p, false);
          }
        });
        if (S.espBotCheck) {
          this.runHook('esp-bots', () => {
            for (const raw of (this.game.AI?.ais || [])) {
              const b = fromPage(raw);
              if (!b?.mesh || !b.mesh.visible || b.health <= 0) continue;
              this.drawCanvasESP(b, true);
            }
          });
        }
        if (S.espBones) {
          this.runHook('esp-bones', () => this.drawSkeletons());
        }
      } catch {}
    }

    world2Screen(pos) {
      const cam = this.renderer?.camera;
      if (!cam) return null;
      this.tempVector.set(pos.x, pos.y, pos.z);
      this.tempVector.project(cam);
      if (this.tempVector.z > 1) return null;
      const c = this.ctx.canvas;
      return {
        x: (this.tempVector.x  * 0.5 + 0.5) * c.width,
        y: (-this.tempVector.y * 0.5 + 0.5) * c.height,
      };
    }

    drawESPBox(ctx, x, y, w, h, pal) {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, pal.primary);
      g.addColorStop(1, pal.secondary);
      ctx.strokeStyle = g;
      ctx.shadowColor = pal.primary;
      ctx.shadowBlur  = 8;
      ctx.lineWidth   = 1.8;

      if (S.espBoxStyle === 'full') {
        ctx.strokeRect(x, y, w, h);
      } else {
        const c = Math.min(w * 0.26, h * 0.18, 22);
        ctx.beginPath();
        for (const [cx, cy, dx, dy] of [
          [x,   y,    1,  1], [x+w, y,   -1,  1],
          [x,   y+h,  1, -1], [x+w, y+h, -1, -1],
        ]) {
          ctx.moveTo(cx + dx * c, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + dy * c);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    drawESPHealthBar(ctx, x, y, h, hp, maxHp, pal) {
      if (!S.espHealthBar) return;
      if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0 || h <= 0) return;
      const pct = Math.max(0, Math.min(1, hp / maxHp));
      const bw  = Math.max(1, Math.min(16, S.healthBarWidth || 4));
      const bx  = x - 3 - bw;
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle  = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bx, y, bw, h);
      const col = pct > 0.75 ? '#43A047' : pct > 0.4 ? '#FDD835' : '#E53935';
      if (S.healthBarUseTheme) {
        const g2 = ctx.createLinearGradient(bx, y, bx, y + h);
        g2.addColorStop(0, pal.primary);
        g2.addColorStop(1, pal.secondary);
        ctx.fillStyle   = g2;
        ctx.shadowColor = pal.primary;
      } else {
        ctx.fillStyle   = col;
        ctx.shadowColor = col;
      }
      ctx.shadowBlur = S.healthBarShadow ? 6 : 0;
      ctx.fillRect(bx, y + h * (1 - pct), bw, h * pct);
      ctx.font        = 'bold 11px Rajdhani,sans-serif';
      ctx.textAlign   = 'right';
      ctx.fillStyle   = '#fff';
      ctx.shadowColor = '#000';
      ctx.shadowBlur  = S.healthBarShadow ? 4 : 0;
      ctx.fillText('♥ ' + Math.round(hp), bx - 4, y + 11);
      ctx.restore();
    }

    drawCanvasESP(entity, isBot) {
      if (!this.ctx || !entity) return;
      if (S.espTeamCheck && !isBot && this.isTeam(entity)) return;

      const pal  = this.espPalette(isBot);
      let drawPal = pal;
      if (!isBot) {
        if (this.aimTarget === entity) {
          drawPal = { primary: '#fff', secondary: '#ff0' };
        } else {
          if (S.espWallCheck) {
            if (!this._visCache) this._visCache = new WeakMap();
            const cached = this._visCache.get(entity);
            let visible;
            if (cached && cached.frame > this.hookStats.frames - 10) {
              visible = cached.value;
            } else {
              visible = this.getCanSee(entity);
              this._visCache.set(entity, { frame: this.hookStats.frames, value: visible });
            }
            drawPal = visible
              ? { primary: '#ffffff', secondary: '#cccccc' }
              : { primary: '#111111', secondary: '#333333' };
          } else {
            drawPal = { primary: '#ffffff', secondary: '#cccccc' };
          }
        }
      }
      const ex   = entity.x ?? 0, ez = entity.z ?? 0, ey = entity.y ?? 0;
      const crV  = Math.max(0, Math.min(1, Number(entity.crouchVal ?? entity.cV ?? 0)));
      const bH   = isBot
        ? this.PLAYER_HEIGHT / this.BOT_CROUCH_FACTOR
        : this.PLAYER_HEIGHT / (crV > 0 ? this.CROUCH_FACTOR : 1);
      const hw   = this.PLAYER_WIDTH / 2;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let any  = false;

      for (const pt of [
        { x: ex-hw, y: ey,    z: ez-hw }, { x: ex+hw, y: ey,    z: ez-hw },
        { x: ex-hw, y: ey+bH, z: ez-hw }, { x: ex+hw, y: ey+bH, z: ez-hw },
        { x: ex-hw, y: ey,    z: ez+hw }, { x: ex+hw, y: ey+bH, z: ez+hw },
        { x: ex-hw, y: ey+bH, z: ez+hw }, { x: ex+hw, y: ey+bH, z: ez+hw },
      ]) {
        const s = this.world2Screen(pt);
        if (!s) continue;
        any = true;
        if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
        if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
      }
      if (!any) return;

      const bw = maxX - minX, bh = maxY - minY;
      if (bw < 2 || bh < 2) return;

      const ctx = this.ctx;

      if (S.espSquare) this.drawESPBox(ctx, minX, minY, bw, bh, drawPal);

      this.drawESPHealthBar(ctx, minX, minY, bh, entity.health, entity.maxHealth ?? 100, drawPal);

      if (S.espLines) {
        const cvs  = ctx.canvas;
        const foot = this.world2Screen({ x: ex, y: ey, z: ez });
        if (foot) {
          const g3 = ctx.createLinearGradient(cvs.width / 2, cvs.height, foot.x, foot.y);
          g3.addColorStop(0, 'transparent');
          g3.addColorStop(1, drawPal.primary);
          ctx.strokeStyle = g3;
          ctx.shadowColor = drawPal.primary;
          ctx.shadowBlur  = 4;
          ctx.lineWidth   = 1;
          ctx.beginPath();
          ctx.moveTo(cvs.width / 2, cvs.height);
          ctx.lineTo(foot.x, foot.y);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }

      if (S.espNameTags) {
        const cp   = this.renderer.camera.position;
        const dist = Math.round(Math.sqrt(
          (ex - cp.x) ** 2 + (ey + this.CAMERA_HEIGHT - cp.y) ** 2 + (ez - cp.z) ** 2
        ));
        const name = entity.alias || entity.name || (isBot ? 'Bot' : '?');
        const tag  = `${name}  ${dist}m`;
        ctx.font      = 'bold 11px Rajdhani,sans-serif';
        ctx.textAlign = 'center';
        const tw = ctx.measureText(tag).width;
        const tx = minX + bw / 2, ty = minY - 4;
        if (S.espInfoBackground) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(tx - tw / 2 - 4, ty - 12, tw + 8, 14);
        }
        const g4 = ctx.createLinearGradient(tx - tw / 2, 0, tx + tw / 2, 0);
        g4.addColorStop(0, drawPal.primary);
        g4.addColorStop(1, drawPal.secondary);
        ctx.fillStyle   = g4;
        ctx.shadowColor = '#000';
        ctx.shadowBlur  = 4;
        ctx.fillText(tag, tx, ty);
        ctx.shadowBlur = 0;
      }
    }

    drawSkeletons() {
      if (!this.three || !this.game) return;
      const ctx = this.ctx;
      const pal = this.espPalette(false);

      const draw = (entity, isBot) => {
        if (S.espTeamCheck && !isBot && this.isTeam(entity)) return;
        const segs = this.getSkeletonSegments(entity);
        if (!segs?.length) return;
        for (const [a, b] of segs) {
          const sa = this.world2Screen(a);
          const sb = this.world2Screen(b);
          if (!sa || !sb) continue;
          const g = ctx.createLinearGradient(sa.x, sa.y, sb.x, sb.y);
          g.addColorStop(0, pal.primary);
          g.addColorStop(1, pal.secondary);
          ctx.strokeStyle = g;
          ctx.shadowColor = pal.primary;
          ctx.shadowBlur  = 4;
          ctx.lineWidth   = 1.5;
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y);
          ctx.lineTo(sb.x, sb.y);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      };

      for (const raw of this.game.players.list) {
        const p = fromPage(raw);
        if (!p || p.isYou || !p.active || !p.objInstances) continue;
        draw(p, false);
      }
      if (S.espBotCheck) {
        for (const raw of (this.game.AI?.ais || [])) {
          const b = fromPage(raw);
          if (!b?.mesh || !b.mesh.visible || b.health <= 0) continue;
          draw(b, true);
        }
      }
    }

    getSkeletonSegments(entity) {
      const cached = this.skeletonCache.get(entity);
      if (cached?.frame === this.hookStats.frames) return cached.segs;
      const segs = this._buildBones(entity);
      this.skeletonCache.set(entity, { frame: this.hookStats.frames, segs });
      return segs;
    }

    _buildBones(entity) {
      if (!entity?.objInstances) return [];
      const segs    = [];
      const visited = new Set();

      const scanBone = (bone, parentPos) => {
        if (!bone || visited.has(bone)) return;
        visited.add(bone);
        const pos = fromPage(bone.getWorldPosition?.(this.tempVector.clone()));
        if (!pos) return;
        if (parentPos) segs.push([
          { x: parentPos.x, y: parentPos.y, z: parentPos.z },
          { x: pos.x,       y: pos.y,       z: pos.z },
        ]);
        for (const child of (fromPage(bone.children) || [])) scanBone(child, pos);
      };

      const scanObj = obj => {
        const o = fromPage(obj);
        if (!o) return;
        if (o.isSkinnedMesh && o.skeleton?.bones?.length) {
          const root = fromPage(o.skeleton.bones[0]);
          if (root) scanBone(root, null);
        }
        for (const child of (fromPage(o.children) || [])) scanObj(child);
      };

      for (const inst of Object.values(fromPage(entity.objInstances) || {})) scanObj(inst);
      return segs;
    }

    drawFov() {
      if (!S.drawFovCircle) return;
      const cam = this.renderer?.camera;
      if (!cam?.projectionMatrix?.elements) return;
      const cvs     = this.ctx.canvas;
      const tanFov  = Math.tan(S.fovSize * Math.PI / 180);
      const focal   = Math.abs(cam.projectionMatrix.elements[5]);
      const radius  = tanFov * focal * cvs.height / 2;
      const cx = cvs.width / 2, cy = cvs.height / 2;

      const g = this.ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
      g.addColorStop(0,   S.themePrimary);
      g.addColorStop(0.5, S.themeMidpoint);
      g.addColorStop(1,   S.themeSecondary);

      this.ctx.strokeStyle = g;
      this.ctx.lineWidth   = 1.5;
      this.ctx.shadowColor = S.themePrimary;
      this.ctx.shadowBlur  = 6;
      this.ctx.globalAlpha = 0.65;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
      this.ctx.shadowBlur  = 0;
    }

    boot() {
      const deadline = Date.now() + 20000;
      const tryHook = () => {
        try {
          this.initializeGameHooks();
      console.log('🌸 WASD: hooks attached ✓  (aimbot=' + S.aimbotEnabled + ', bhop=' + S.bhopEnabled + ', speed=' + S.speedEnabled + ')');
        } catch (e) {
          if (Date.now() < deadline) setTimeout(tryHook, 250);
          else console.warn('🌸 WASD: hook başarısız —', e?.message || e);
        }
      };
      tryHook();
    }
  }

  const cheat = new KrunkerCheat();
  cheat.boot();

  pageWindow.__cheat = cheat;

  function initMenu() {
    if (document.querySelector('#wasd-menu-root')) return;

    let audioCtx = null;
    function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    function playHover() {
      initAudio(); if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(600, t); o.frequency.exponentialRampToValueAtTime(350, t+0.05);
      g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t+0.05);
      o.start(t); o.stop(t+0.05);
    }

    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&family=Share+Tech+Mono&display=swap');
      :root{--card-bg:rgba(8,8,10,0.95);--border:rgba(255,255,255,0.15);--text:#f0f0f0;--muted:#666;}
      #wasd-menu-root *{box-sizing:border-box;}
      #wasd-watermark{position:fixed;top:10px;left:10px;z-index:2147483644;background:rgba(8,8,10,0.88);border:1px solid var(--border);padding:5px 12px;border-radius:8px;font-family:'Share Tech Mono',monospace;font-size:0.7rem;color:#fff;backdrop-filter:blur(10px);display:flex;gap:12px;user-select:none;}
      #wasd-watermark span{color:#888;}
      #wasd-hud{position:fixed;top:28px;right:14px;display:flex;flex-direction:column;align-items:flex-end;gap:2px;z-index:2147483646;font-family:'Share Tech Mono',monospace;user-select:none;pointer-events:none;}
      .af-item{font-size:0.72rem;color:#fff;background:rgba(10,10,12,0.88);padding:2px 10px 2px 8px;border-left:3px solid #fff;backdrop-filter:blur(6px);}
      #wasd-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:2147483645;display:none;pointer-events:none;}
      #snow-canvas{position:absolute;inset:0;width:100%;height:100%;}
      .v-panel{position:fixed;width:240px;background:var(--card-bg);border:1px solid var(--border);box-shadow:0 0 30px rgba(0,0,0,0.9),0 0 15px rgba(255,255,255,0.04);border-radius:16px;backdrop-filter:blur(16px);overflow:hidden;display:none;flex-direction:column;z-index:2147483647;font-family:'Share Tech Mono',monospace;user-select:none;}
      .v-header{padding:10px 14px;background:rgba(255,255,255,0.04);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-family:'Orbitron',sans-serif;font-size:0.78rem;font-weight:800;letter-spacing:2px;color:#fff;cursor:move;}
      .v-content{padding:10px;display:flex;flex-direction:column;gap:7px;overflow-y:auto;max-height:75vh;}
      .ac-head{display:flex;justify-content:space-between;align-items:center;font-family:'Orbitron',sans-serif;font-size:0.65rem;font-weight:800;color:var(--text);letter-spacing:1.5px;text-transform:uppercase;background:rgba(255,255,255,0.03);border:1px solid var(--border);padding:6px 10px;border-radius:8px;cursor:pointer;transition:all .2s;}
      .ac-head:hover{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.4);}
      .ac-arr{font-size:0.7rem;color:#888;transition:transform .25s;}
      .ac-sec.open .ac-arr{transform:rotate(90deg);color:#fff;}
      .ac-body{display:none;flex-direction:column;gap:5px;padding:5px 0 2px 4px;}
      .ac-sec.open .ac-body{display:flex;}
      .s-item{display:flex;justify-content:space-between;align-items:center;font-size:0.73rem;color:var(--text);background:rgba(255,255,255,0.02);padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.04);transition:all .2s;width:100%;}
      .s-item:hover{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.2);}
      .sw{position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;}
      .sw input{opacity:0;width:0;height:0;}
      .sw-sl{position:absolute;cursor:pointer;inset:0;background:rgba(255,255,255,0.1);border:1px solid var(--border);transition:.25s;border-radius:20px;}
      .sw-sl:before{content:"";position:absolute;height:12px;width:12px;left:2px;top:50%;transform:translateY(-50%);background:#666;transition:.25s;border-radius:50%;}
      .sw input:checked+.sw-sl{background:#fff;border-color:#fff;}
      .sw input:checked+.sw-sl:before{transform:translate(14px,-50%);background:#000;}
      .s-slider{width:100%;display:flex;flex-direction:column;gap:5px;padding:6px 8px;}
      .s-slider-head{display:flex;justify-content:space-between;font-size:0.73rem;color:var(--text);}
      .s-slider-val{color:#fff;font-weight:bold;}
      .v-range{width:100%;height:4px;background:rgba(255,255,255,0.1);outline:none;border-radius:2px;appearance:none;cursor:pointer;}
      .v-range::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:#fff;cursor:pointer;box-shadow:0 0 6px #fff;}
      .c-pick{appearance:none;-webkit-appearance:none;border:1px solid var(--border);border-radius:50%;width:16px;height:16px;cursor:pointer;background:transparent;padding:0;outline:none;overflow:hidden;}
      .c-pick::-webkit-color-swatch-wrapper{padding:0;}
      .c-pick::-webkit-color-swatch{border:none;border-radius:50%;}
      .btn-act{width:100%;padding:7px 0;background:rgba(255,255,255,0.05);border:1px solid var(--border);color:#fff;font-family:'Orbitron',sans-serif;font-size:0.63rem;font-weight:800;letter-spacing:1px;border-radius:6px;cursor:pointer;transition:.2s;}
      .btn-act:hover{background:#fff;color:#000;}
      #wasd-key-hint{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:2147483644;background:rgba(8,8,10,0.82);border:1px solid var(--border);padding:4px 14px;border-radius:20px;font-family:'Share Tech Mono',monospace;font-size:0.68rem;color:#888;user-select:none;pointer-events:none;}
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'wasd-menu-root';
    document.body.appendChild(root);

    root.insertAdjacentHTML('beforeend', `
      <div id="wasd-watermark">
        <div>WASD <span>//</span></div>
        <div>FPS: <span id="hud-fps">240</span></div>
        <div>PING: <span id="hud-ping">12ms</span></div>
        <div>STATUS: <span style="color:#fff;font-weight:bold">ACTIVE</span></div>
      </div>
      <div id="wasd-hud"><div id="af-list"></div></div>
      <div id="wasd-overlay"><canvas id="snow-canvas"></canvas></div>
      <div id="wasd-key-hint">[ INSERT ] MENU</div>
    `);

    const cvs = document.getElementById('snow-canvas');
    const cx2 = cvs.getContext('2d');
    let sw = cvs.width = window.innerWidth, sh = cvs.height = window.innerHeight;
    window.addEventListener('resize', () => { sw = cvs.width = window.innerWidth; sh = cvs.height = window.innerHeight; });
    const flakes = Array.from({length:70}, () => ({x:Math.random()*sw, y:Math.random()*sh, r:Math.random()*2+0.8, s:Math.random()*1.2+0.5, w:Math.random()*0.4-0.2}));
    (function snow() {
      cx2.clearRect(0,0,sw,sh); cx2.fillStyle='rgba(255,255,255,0.75)'; cx2.beginPath();
      flakes.forEach(f=>{cx2.moveTo(f.x,f.y);cx2.arc(f.x,f.y,f.r,0,Math.PI*2);});
      cx2.fill();
      flakes.forEach(f=>{f.y+=f.s;f.x+=f.w;if(f.y>sh){f.y=0;f.x=Math.random()*sw;}});
      requestAnimationFrame(snow);
    })();

    const settingMap = {
      'Aimbot':       () => { S.aimbotEnabled    = !S.aimbotEnabled;    return S.aimbotEnabled; },
      'Always Aim':   () => { S.aimbotKey = S.aimbotKey==='always'?'mouse2':'always'; return S.aimbotKey==='always'; },
      'Auto Fire':    () => { S.autoFireEnabled   = !S.autoFireEnabled;  return S.autoFireEnabled; },
      'Wall Check':   () => { S.aimbotWallCheck   = !S.aimbotWallCheck;  return S.aimbotWallCheck; },
      'Team Check':   () => { S.aimbotTeamCheck   = !S.aimbotTeamCheck;  return S.aimbotTeamCheck; },
      'Anti-Aim':     () => { S.antiBotEnabled    = !S.antiBotEnabled;   return S.antiBotEnabled; },
      'BHop':         () => { S.bhopEnabled       = !S.bhopEnabled;      return S.bhopEnabled; },
      'Auto Reload':  () => { S.autoReloadEnabled = !S.autoReloadEnabled;return S.autoReloadEnabled; },
      'No Recoil':    () => { S.noRecoilEnabled   = !S.noRecoilEnabled;  return S.noRecoilEnabled; },
      'ESP Box':      () => { S.espSquare         = !S.espSquare;        return S.espSquare; },
      'ESP Lines':    () => { S.espLines          = !S.espLines;         return S.espLines; },
      'ESP Skeleton': () => { S.espBones          = !S.espBones;         return S.espBones; },
      'Health Bar':   () => { S.espHealthBar      = !S.espHealthBar;     return S.espHealthBar; },
      'Name Tags':    () => { S.espNameTags       = !S.espNameTags;      return S.espNameTags; },
      'Wall Colors':  () => { S.espWallCheck      = !S.espWallCheck;     return S.espWallCheck; },
      'FOV Circle':   () => { S.drawFovCircle     = !S.drawFovCircle;    return S.drawFovCircle; },
      'ESP Glow':     () => { S.espGlow           = !S.espGlow;          return S.espGlow; },
      '3rd Person':   () => { S.thirdPersonEnabled= !S.thirdPersonEnabled; return S.thirdPersonEnabled; },
    };
    const initState = {
      'Aimbot': S.aimbotEnabled, 'Always Aim': S.aimbotKey==='always',
      'Auto Fire': S.autoFireEnabled, 'Wall Check': S.aimbotWallCheck,
      'Team Check': S.aimbotTeamCheck, 'Anti-Aim': S.antiBotEnabled,
      'BHop': S.bhopEnabled, 'Auto Reload': S.autoReloadEnabled,
      'No Recoil': S.noRecoilEnabled, 'ESP Box': S.espSquare,
      'ESP Lines': S.espLines, 'ESP Skeleton': S.espBones,
      'Health Bar': S.espHealthBar, 'Name Tags': S.espNameTags,
      'Wall Colors': S.espWallCheck, 'FOV Circle': S.drawFovCircle,
      'ESP Glow': S.espGlow, '3rd Person': S.thirdPersonEnabled,
    };

    function toggle(name, cb) {
      if (settingMap[name]) { const v = settingMap[name](); cb && cb(v); updateHUD(); }
    }

    function mkSwitch(name) {
      const on = initState[name] ?? false;
      return `<label class="sw"><input type="checkbox" data-s="${name}" ${on?'checked':''}><span class="sw-sl"></span></label>`;
    }

    const panels = [
      { id:'p-aim', title:'⬡ AIM', top:'50px', left:'30px', html:`
        <div class="ac-sec open">
          <div class="ac-head"><span>General</span><span class="ac-arr">▶</span></div>
          <div class="ac-body">
            <div class="s-item"><span>Aimbot</span>${mkSwitch('Aimbot')}</div>
            <div class="s-item"><span>Always Active</span>${mkSwitch('Always Aim')}</div>
            <div class="s-item"><span>Auto Fire</span>${mkSwitch('Auto Fire')}</div>
            <div class="s-item"><span>Auto Reload</span>${mkSwitch('Auto Reload')}</div>
          </div>
        </div>
        <div class="ac-sec open">
          <div class="ac-head"><span>Checks</span><span class="ac-arr">▶</span></div>
          <div class="ac-body">
            <div class="s-item"><span>Wall Check</span>${mkSwitch('Wall Check')}</div>
            <div class="s-item"><span>Team Check</span>${mkSwitch('Team Check')}</div>
          </div>
        </div>
        <div class="ac-sec open">
          <div class="ac-head"><span>FOV & Smooth</span><span class="ac-arr">▶</span></div>
          <div class="ac-body">
            <div class="s-slider">
              <div class="s-slider-head"><span>FOV Size</span><span class="s-slider-val" id="v-fov">${S.fovSize}°</span></div>
              <input type="range" class="v-range" id="sl-fov" min="5" max="60" value="${S.fovSize}">
            </div>
            <div class="s-slider">
              <div class="s-slider-head"><span>Smooth Speed</span><span class="s-slider-val" id="v-spd">${S.flickSpeed}</span></div>
              <input type="range" class="v-range" id="sl-spd" min="1" max="100" value="${S.flickSpeed}">
            </div>
          </div>
        </div>
      `},
      { id:'p-vis', title:'⬡ VISUALS', top:'50px', left:'285px', html:`
        <div class="ac-sec open">
          <div class="ac-head"><span>ESP</span><span class="ac-arr">▶</span></div>
          <div class="ac-body">
            <div class="s-item"><span>Box</span>${mkSwitch('ESP Box')}</div>
            <div class="s-item"><span>Skeleton</span>${mkSwitch('ESP Skeleton')}</div>
            <div class="s-item"><span>Health Bar</span>${mkSwitch('Health Bar')}</div>
            <div class="s-item"><span>Name Tags</span>${mkSwitch('Name Tags')}</div>
            <div class="s-item"><span>Tracers</span>${mkSwitch('ESP Lines')}</div>
            <div class="s-item"><span>Wall Colors</span>${mkSwitch('Wall Colors')}</div>
            <div class="s-item"><span>Glow</span>${mkSwitch('ESP Glow')}</div>
          </div>
        </div>
        <div class="ac-sec open">
          <div class="ac-head"><span>Colors</span><span class="ac-arr">▶</span></div>
          <div class="ac-body">
            <div class="s-item"><span>ESP Color</span><input type="color" class="c-pick" id="col-esp" value="${S.espColor}"></div>
            <div class="s-item"><span>Box Color</span><input type="color" class="c-pick" id="col-box" value="${S.boxColor}"></div>
            <div class="s-item"><span>FOV Circle</span>${mkSwitch('FOV Circle')}</div>
          </div>
        </div>
      `},
      { id:'p-move', title:'⬡ MOVEMENT', top:'50px', left:'540px', html:`
        <div class="ac-sec open">
          <div class="ac-head"><span>Movement</span><span class="ac-arr">▶</span></div>
          <div class="ac-body">
            <div class="s-item"><span>Bunny Hop</span>${mkSwitch('BHop')}</div>
            <div class="s-item"><span>Anti-Aim</span>${mkSwitch('Anti-Aim')}</div>
            <div class="s-item"><span>No Recoil</span>${mkSwitch('No Recoil')}</div>
            <div class="s-item"><span>3rd Person</span>${mkSwitch('3rd Person')}</div>
          </div>
        </div>
        <div class="ac-sec open">
          <div class="ac-head"><span>Config</span><span class="ac-arr">▶</span></div>
          <div class="ac-body">
            <button class="btn-act" id="btn-save">SAVE CONFIG</button>
            <button class="btn-act" id="btn-load">LOAD CONFIG</button>
          </div>
        </div>
      `},
    ];

    panels.forEach(conf => {
      const p = document.createElement('div');
      p.className = 'v-panel'; p.id = conf.id;
      p.style.top = conf.top; p.style.left = conf.left;
      p.innerHTML = `<div class="v-header">${conf.title} <span>❖</span></div><div class="v-content">${conf.html}</div>`;
      root.appendChild(p);
      const hdr = p.querySelector('.v-header');
      let drag=false, ox=0, oy=0;
      hdr.addEventListener('mousedown', e => { drag=true; ox=p.offsetLeft-e.clientX; oy=p.offsetTop-e.clientY; p.style.zIndex=2147483647; });
      document.addEventListener('mouseup', () => drag=false);
      document.addEventListener('mousemove', e => { if(drag){p.style.left=(e.clientX+ox)+'px';p.style.top=(e.clientY+oy)+'px';} });
    });

    document.querySelectorAll('.ac-head').forEach(h => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
    });

    document.querySelectorAll('[data-s]').forEach(inp => {
      inp.addEventListener('change', () => {
        const name = inp.dataset.s;
        if (settingMap[name]) {
          const val = settingMap[name]();
          inp.checked = val;
          updateHUD();
        }
      });
    });

    document.getElementById('sl-fov').addEventListener('input', e => {
      S.fovSize = Number(e.target.value);
      document.getElementById('v-fov').textContent = S.fovSize + '°';
    });
    document.getElementById('sl-spd').addEventListener('input', e => {
      S.flickSpeed = Number(e.target.value);
      document.getElementById('v-spd').textContent = S.flickSpeed;
    });

    document.getElementById('col-esp').addEventListener('input', e => { S.espColor = e.target.value; });
    document.getElementById('col-box').addEventListener('input', e => { S.boxColor = e.target.value; });

    document.getElementById('btn-save').addEventListener('click', () => {
      const cfg = {};
      document.querySelectorAll('[data-s]').forEach(i => cfg[i.dataset.s] = i.checked);
      cfg.fovSize = S.fovSize; cfg.flickSpeed = S.flickSpeed;
      cfg.espColor = S.espColor; cfg.boxColor = S.boxColor;
      localStorage.setItem('wasd_cfg', JSON.stringify(cfg));
      alert('✅ Config kaydedildi!');
    });
    document.getElementById('btn-load').addEventListener('click', () => {
      const saved = localStorage.getItem('wasd_cfg');
      if (!saved) { alert('❌ Kayıtlı config yok!'); return; }
      const cfg = JSON.parse(saved);
      document.querySelectorAll('[data-s]').forEach(i => {
        if (cfg[i.dataset.s] !== undefined) {
          i.checked = cfg[i.dataset.s];
          if (settingMap[i.dataset.s]) settingMap[i.dataset.s]();
          i.checked = cfg[i.dataset.s];
        }
      });
      if (cfg.fovSize)    { S.fovSize = cfg.fovSize; document.getElementById('sl-fov').value = cfg.fovSize; document.getElementById('v-fov').textContent = cfg.fovSize+'°'; }
      if (cfg.flickSpeed) { S.flickSpeed = cfg.flickSpeed; document.getElementById('sl-spd').value = cfg.flickSpeed; document.getElementById('v-spd').textContent = cfg.flickSpeed; }
      if (cfg.espColor)   { S.espColor = cfg.espColor; document.getElementById('col-esp').value = cfg.espColor; }
      if (cfg.boxColor)   { S.boxColor = cfg.boxColor; document.getElementById('col-box').value = cfg.boxColor; }
      updateHUD(); alert('✅ Config yüklendi!');
    });

    document.querySelectorAll('.s-item,.ac-head,.btn-act').forEach(el => el.addEventListener('mouseenter', playHover));

    function updateHUD() {
      const list = document.getElementById('af-list');
      list.innerHTML = '';
      Object.entries(initState).forEach(([name]) => {
        const on = (() => {
          switch(name) {
            case 'Aimbot':      return S.aimbotEnabled;
            case 'Always Aim':  return S.aimbotKey==='always';
            case 'Auto Fire':   return S.autoFireEnabled;
            case 'Wall Check':  return S.aimbotWallCheck;
            case 'Team Check':  return S.aimbotTeamCheck;
            case 'Anti-Aim':    return S.antiBotEnabled;
            case 'BHop':        return S.bhopEnabled;
            case 'Auto Reload': return S.autoReloadEnabled;
            case 'No Recoil':   return S.noRecoilEnabled;
            case 'ESP Box':     return S.espSquare;
            case 'ESP Lines':   return S.espLines;
            case 'ESP Skeleton':return S.espBones;
            case 'Health Bar':  return S.espHealthBar;
            case 'Name Tags':   return S.espNameTags;
            case 'Wall Colors': return S.espWallCheck;
            case 'FOV Circle':  return S.drawFovCircle;
            case 'ESP Glow':    return S.espGlow;
            case '3rd Person':  return S.thirdPersonEnabled;
            default: return false;
          }
        })();
        if (on) {
          const d = document.createElement('div');
          d.className = 'af-item';
          d.textContent = name;
          list.appendChild(d);
        }
      });
    }

    updateHUD();

    setInterval(() => {
      document.getElementById('hud-fps').textContent = Math.floor(Math.random()*20+225);
      document.getElementById('hud-ping').textContent = Math.floor(Math.random()*6+9)+'ms';
    }, 2000);

    let menuOpen = false;
    const overlay = document.getElementById('wasd-overlay');
    window.addEventListener('keydown', e => {
      if (e.key === 'Insert' || e.code === 'Insert') {
        menuOpen = !menuOpen;
        document.querySelectorAll('.v-panel').forEach(p => p.style.display = menuOpen ? 'flex' : 'none');
        overlay.style.display = menuOpen ? 'block' : 'none';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMenu);
  } else {
    setTimeout(initMenu, 500);
  }

})();
