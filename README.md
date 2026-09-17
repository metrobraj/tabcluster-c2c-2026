# tabCluster

> **Decentralized Peer-to-Peer Local Computing Engine**

tabCluster transforms ordinary consumer devices into a unified virtual supercomputer. By leveraging browser-based P2P networking alongside local native thread execution, tabCluster allows developers, researchers, and students to run distributed batch math, 3D renders, and parallel data workloads without incurring centralized cloud infrastructure expenses.

The live host dashboard is deployed on Render and accessible via a public URL, making it effortless to spawn a cluster room instantly from any browser.  
To access: https://tabcluster-c2c-2026-tig5.onrender.com

---

## Key Features

* **Zero-Server Peer-to-Peer Mesh:** Connect worker devices instantly via QR code or room code using WebRTC DataChannels. No intermediate servers store or process payload data.
* **Modular Task Splitter & Plugin Architecture:** Custom job dispatcher system equipped with templates for different distributed computing patterns:
  * **2D/3D Frame Splitter:** Parallel visual rendering (Ray tracing, Fractals, Canvas tiles).
  * **Parameter Grid Splitter:** Multi-dimensional hyperparameter search and simulation scoring.
  * **Data Stream Splitter:** High-volume array processing and sequence evaluation (Collatz Conjecture, statistical sweeps).
  * **Range/Key Splitter:** Distributed cryptographic key search and parallel state space search.
  * **Mini-Batch Splitter:** Parallel mini-batch gradient calculations for machine learning workflows.
* **Native Worker Nodes (OS-Level Multi-Threading):** An opt-in execution tier that bypasses browser sandbox limitations. Native Python workers connect via WebSockets to execute unthrottled, multi-threaded CPU tasks at native speed.
* **GPU Hardware Acceleration (Experimental):** Experimental WebGPU/WebGL acceleration pipelines for matrix-heavy node tasks.
* **Blender Distributed Render Engine (Experimental):** Offload 3D Blender frame chunk rendering across connected cluster nodes(Incomplete).
* **Fault Tolerance & Heartbeat Recovery:** Automatic 3-second heartbeat pipeline. Disconnected worker tasks are detected and automatically re-queued to active cluster nodes without data loss.

---

## Tech Stack

* **Frontend & UI:** HTML5, CSS3, HTML5 Canvas API
* **P2P Communication:** WebRTC DataChannels, PeerJS (Client & Signaling)
* **Browser Compute:** Native HTML5 Web Workers API, ArrayBuffer / Uint8ClampedArray binary transport
* **Native Compute:** Python (Standard Library, WebSockets, multiprocessing)
* **Deployment:** Hosted on Render
* **Hardware Interfacing:** navigator.hardwareConcurrency

---

## Quick Start

### 1. Browser Cluster Host (Master Node)
1. Open the hosted Render deployment link in your browser.
2. Share the generated Room URL or QR code with peer devices.

### 2. Browser Worker Nodes
* Peer devices simply scan the host QR code or open the Room URL in any mobile or desktop browser.
* Compute runs automatically in background Web Workers.

### 3. Native Worker Nodes (Power User Mode)
To connect a machine with full multi-threaded CPU access:
python worker.py --room-id <YOUR_ROOM_ID>

---

## Issues and Future ideas

* **Codebase Refactoring & Cleanup:** Modularize core networking and dispatcher layers to clean up rapid prototype code.
* **Frontend Revamp:** Overhaul the frontend, add interactive node topology charts, and improve streaming telemetry displays.
* **Blender Service Expansion:** Stabilize frame-splitting and asset distribution pipelines for the experimental Blender rendering plugin.
* **Plugin System Overhaul:** Expand WebAssembly (WASM) and WebGPU support across custom user plugins.

---

## Made with love by

**Team lag demon cartel**

* **BRAJENDRA PANDEY** - [GitHub Profile](https://github.com/metrobraj)
* **RUDRA PRATAP SINGH** - [GitHub Profile](https://github.com/rudrapsin9h)
