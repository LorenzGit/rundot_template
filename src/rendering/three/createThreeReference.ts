/**
 * Three.js renderer reference.
 *
 * This module owns only Three-specific work: renderer selection, the 3D world,
 * an optional Three-rendered HUD, responsive cameras, and GPU cleanup. The
 * shared lab coordinator owns timing, visibility, and Pixi composition.
 */
import * as THREE from "three/webgpu";

export interface ThreeReference {
    readonly backend: "THREE · WEBGPU" | "THREE · WEBGL 2";
    resize(width: number, height: number): void;
    render(elapsedSeconds: number): void;
    destroy(): void;
}

interface ThreeReferenceOptions {
    host: HTMLElement;
    maxPixelRatio: number;
    reducedMotion: boolean;
    showThreeUi: boolean;
}

interface InitializedRenderer {
    renderer: THREE.WebGPURenderer;
    backend: ThreeReference["backend"];
}

type Disposable = { dispose(): void };

async function initializeRenderer(maxPixelRatio: number, forceWebGL: boolean): Promise<InitializedRenderer> {
    const renderer = new THREE.WebGPURenderer({
        alpha: false,
        antialias: true,
        forceWebGL,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
    try {
        await renderer.init();
    } catch (error) {
        renderer.dispose();
        throw error;
    }

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const backend = renderer.coordinateSystem === THREE.WebGPUCoordinateSystem ? "THREE · WEBGPU" : "THREE · WEBGL 2";
    return { renderer, backend };
}

async function createRenderer(maxPixelRatio: number): Promise<InitializedRenderer> {
    const forcedBackend = new URLSearchParams(window.location.search).get("renderer");
    if (forcedBackend === "webgl") return initializeRenderer(maxPixelRatio, true);

    try {
        // WebGPURenderer automatically falls back when WebGPU is absent. The
        // explicit retry also covers adapter/device failures during init.
        return await initializeRenderer(maxPixelRatio, false);
    } catch (webGpuError) {
        console.warn("[renderer-lab] Three WebGPU initialization failed; retrying with WebGL 2", webGpuError);
        return initializeRenderer(maxPixelRatio, true);
    }
}

export async function createThreeReference(options: ThreeReferenceOptions): Promise<ThreeReference> {
    const { renderer, backend } = await createRenderer(options.maxPixelRatio);
    const resources: Disposable[] = [];
    const track = <T extends Disposable>(resource: T): T => {
        resources.push(resource);
        return resource;
    };

    renderer.domElement.className = "renderer-lab-canvas renderer-lab-world";
    renderer.domElement.dataset.layer = "three-world";
    renderer.domElement.setAttribute("aria-hidden", "true");
    options.host.appendChild(renderer.domElement);

    const world = new THREE.Scene();
    world.background = new THREE.Color(0x07141c);
    world.fog = new THREE.Fog(0x07141c, 8, 23);

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 60);
    camera.position.set(0, 2.4, 8.2);
    camera.lookAt(0, 0.35, 0);

    world.add(new THREE.HemisphereLight(0x8dd9ff, 0x09121e, 2.25));
    const keyLight = new THREE.DirectionalLight(0xffd166, 5.2);
    keyLight.position.set(4, 6, 5);
    world.add(keyLight);

    const artifact = new THREE.Group();
    world.add(artifact);

    const core = new THREE.Mesh(
        track(new THREE.IcosahedronGeometry(1.28, 1)),
        track(
            new THREE.MeshStandardMaterial({
                color: 0xf4c95d,
                emissive: 0x3b2309,
                metalness: 0.54,
                roughness: 0.24,
            }),
        ),
    );
    artifact.add(core);

    const cage = new THREE.LineSegments(
        track(new THREE.EdgesGeometry(track(new THREE.BoxGeometry(3.45, 3.45, 3.45)))),
        track(new THREE.LineBasicMaterial({ color: 0x5aa7c7, transparent: true, opacity: 0.64 })),
    );
    cage.rotation.set(0.3, 0.48, 0.18);
    artifact.add(cage);

    const orbit = new THREE.Mesh(
        track(new THREE.TorusGeometry(2.36, 0.035, 8, 96)),
        track(new THREE.MeshBasicMaterial({ color: 0xf4c95d, transparent: true, opacity: 0.82 })),
    );
    orbit.rotation.set(1.12, 0.26, 0);
    artifact.add(orbit);

    const grid = new THREE.GridHelper(18, 24, 0x5aa7c7, 0x163443);
    grid.position.y = -2.15;
    world.add(grid);
    track(grid.geometry);
    if (Array.isArray(grid.material)) {
        for (const material of grid.material) track(material);
    } else {
        track(grid.material);
    }

    const starsGeometry = track(new THREE.BufferGeometry());
    const starPositions = new Float32Array(42 * 3);
    for (let index = 0; index < 42; index += 1) {
        const stride = index * 3;
        starPositions[stride] = Math.sin(index * 2.17) * (4.2 + (index % 5) * 0.54);
        starPositions[stride + 1] = Math.cos(index * 1.31) * 3.6;
        starPositions[stride + 2] = -2.5 - (index % 9) * 1.35;
    }
    starsGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
        starsGeometry,
        track(new THREE.PointsMaterial({ color: 0xbcecff, size: 0.055, transparent: true, opacity: 0.76 })),
    );
    world.add(stars);

    const uiScene = new THREE.Scene();
    const uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    uiCamera.position.z = 2;
    const uiRoot = new THREE.Group();
    uiScene.add(uiRoot);

    let meterWidth = 1;
    let meterBackground: THREE.Mesh | null = null;
    let meterFill: THREE.Mesh | null = null;
    if (options.showThreeUi) {
        const uiMaterial = track(
            new THREE.MeshBasicMaterial({
                color: 0xf4c95d,
                transparent: true,
                opacity: 0.92,
                depthTest: false,
                depthWrite: false,
            }),
        );
        const mutedUiMaterial = track(
            new THREE.MeshBasicMaterial({
                color: 0x5aa7c7,
                transparent: true,
                opacity: 0.42,
                depthTest: false,
                depthWrite: false,
            }),
        );
        const reticle = new THREE.Mesh(track(new THREE.RingGeometry(0.105, 0.122, 40)), uiMaterial);
        uiRoot.add(reticle);

        meterBackground = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), mutedUiMaterial);
        meterBackground.position.y = -0.78;
        uiRoot.add(meterBackground);

        meterFill = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), uiMaterial);
        meterFill.position.y = -0.78;
        meterFill.position.z = 0.01;
        uiRoot.add(meterFill);

        for (const x of [-1, 1]) {
            const marker = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), uiMaterial);
            marker.position.set(x * 0.72, 0.72, 0);
            marker.scale.set(0.035, 0.18, 1);
            uiRoot.add(marker);
        }
    }

    let destroyed = false;

    return {
        backend,

        resize(width, height) {
            if (destroyed) return;
            const safeWidth = Math.max(1, width);
            const safeHeight = Math.max(1, height);
            const aspect = safeWidth / safeHeight;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, options.maxPixelRatio));
            renderer.setSize(safeWidth, safeHeight, false);
            camera.aspect = aspect;
            camera.updateProjectionMatrix();
            uiCamera.left = -aspect;
            uiCamera.right = aspect;
            uiCamera.top = 1;
            uiCamera.bottom = -1;
            uiCamera.updateProjectionMatrix();
            meterWidth = Math.min(1.35, aspect * 0.72);
        },

        render(elapsedSeconds) {
            if (destroyed) return;
            const time = options.reducedMotion ? 0.82 : elapsedSeconds;
            artifact.rotation.y = time * 0.32;
            artifact.rotation.x = Math.sin(time * 0.42) * 0.12;
            core.rotation.z = time * -0.27;
            cage.rotation.y = 0.48 + time * -0.18;
            orbit.rotation.z = time * 0.22;
            stars.rotation.y = time * 0.012;

            renderer.autoClear = true;
            renderer.render(world, camera);

            if (options.showThreeUi && meterFill) {
                const energy = 0.68 + Math.sin(time * 1.35) * 0.18;
                const fillWidth = meterWidth * energy;
                meterBackground?.scale.set(meterWidth, 0.045, 1);
                meterFill.scale.set(fillWidth, 0.045, 1);
                meterFill.position.x = -(meterWidth - fillWidth) / 2;
                renderer.autoClear = false;
                renderer.clearDepth();
                renderer.render(uiScene, uiCamera);
                renderer.autoClear = true;
            }
        },

        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const resource of resources.reverse()) resource.dispose();
            renderer.dispose();
            renderer.domElement.remove();
            world.clear();
            uiScene.clear();
        },
    };
}
