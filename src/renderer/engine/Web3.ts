import { createPublicClient, http, getAddress, type Address } from 'viem';

// Minimal wallet + Ponks reader.
// Connect MetaMask (window.ethereum), prompt switch to PulseChain (chainId 369),
// then read the user's Ponks balance and token IDs via the read-only RPC.
//
// We use a direct viem PublicClient (no wagmi/react) because HairyEngine is
// vanilla TS without React. Caching of resolved NFT image URLs goes through
// the browser's IndexedDB via the small helper at the bottom.

const PONKS_CONTRACT: Address = '0x2ec50f63699c802f7a36fa6e490b99f863cf40ba';

// Minimal ERC-721 (+ Enumerable) ABI fragments — all we need.
const ERC721_ABI = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// PulseChain mainnet definition for viem. Avoids depending on viem/chains
// (which had `pulsechain` removed/renamed at points).
const pulsechain = {
  id: 369,
  name: 'PulseChain',
  network: 'pulsechain',
  nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.pulsechain.com'] },
    public: { http: ['https://rpc.pulsechain.com'] },
  },
  blockExplorers: {
    default: { name: 'PulseScan', url: 'https://scan.pulsechain.com' },
  },
} as const;

const publicClient = createPublicClient({
  chain: pulsechain as unknown as Parameters<typeof createPublicClient>[0]['chain'],
  transport: http(),
});

export type Ponk = {
  tokenId: bigint;
  tokenURI: string;
  imageUrl?: string;
  name?: string;
};

// Apply a Ponk's image as the diffuse texture of an Object3D's first
// MeshStandardMaterial. Loads the texture via THREE.TextureLoader and
// flips Y for correct orientation. Returns true on success.
export async function applyPonkTexture(
  url: string,
  target: import('three').Object3D,
): Promise<boolean> {
  const THREE = await import('three');
  const loader = new THREE.TextureLoader();
  loader.crossOrigin = 'anonymous';
  const texture = await new Promise<import('three').Texture | null>((resolve) => {
    loader.load(
      url,
      (t) => resolve(t),
      undefined,
      (err) => {
        console.error('[ponks] texture load failed:', err);
        resolve(null);
      },
    );
  });
  if (!texture) return false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  let applied = false;
  target.traverse((o) => {
    const m = o as import('three').Mesh;
    if (m.isMesh && m.material && !Array.isArray(m.material)) {
      const mat = m.material as import('three').MeshStandardMaterial;
      mat.map = texture;
      // Lighten the base color so the texture reads cleanly
      if (mat.color) mat.color.set('#ffffff');
      mat.needsUpdate = true;
      applied = true;
    }
  });
  return applied;
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export async function connectWallet(): Promise<Address | null> {
  const eth = window.ethereum;
  // Electron desktop usually has no window.ethereum (MetaMask is a browser
  // extension). Fall back to "read-only" mode: ask the user to paste their
  // PulseChain address; we still read their Ponks via the public RPC.
  if (!eth) {
    const pasted = await promptForAddress();
    if (!pasted) return null;
    try {
      return getAddress(pasted.trim());
    } catch (err) {
      console.error('[wallet] address invalid:', err);
      alert(`That doesn't look like a valid Ethereum/PulseChain address.\n${(err as Error).message}`);
      return null;
    }
  }
  try {
    console.info('[wallet] requesting accounts via window.ethereum…');
    const accounts = (await eth.request({
      method: 'eth_requestAccounts',
    })) as string[];
    console.info('[wallet] returned accounts:', accounts);
    if (!accounts || accounts.length === 0) return null;
    const address = getAddress(accounts[0]);
    try {
      await ensurePulseChain();
    } catch (err) {
      console.warn('[wallet] PulseChain switch failed but address is connected:', err);
      // Continue anyway — we can still read NFTs via our public RPC.
    }
    return address;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    console.error('[wallet] connect failed:', err);
    alert(`Wallet connect failed: ${message}\n\nFalling back to read-only mode. Paste your address to view Ponks.`);
    const pasted = await promptForAddress();
    if (!pasted) return null;
    try {
      return getAddress(pasted.trim());
    } catch {
      return null;
    }
  }
}

/** Modal that asks the user to paste a 0x… address, returning null on cancel.
 *  Used when there's no injected wallet (default Electron case) so the user
 *  can still view their Ponks without installing a browser extension. */
function promptForAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'claude-modal-backdrop';
    backdrop.innerHTML = `
      <div class="claude-modal">
        <div class="claude-modal-head">🦊 Read-only Wallet</div>
        <div class="claude-modal-body">
          <div style="font-size: 13px; line-height: 1.55;">
            HairyEngine runs as a desktop app, so MetaMask (a browser extension) isn't available here.
            <br><br>
            Paste your <strong>PulseChain address</strong> below to view your Ponks. This is <strong>read-only</strong> — no signing, no transactions, just reading the public chain.
          </div>
          <input id="wallet-addr-input" type="text" placeholder="0x..."
            style="margin-top: 14px; width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 4px; color: var(--text); font-family: ui-monospace, monospace; font-size: 12px;">
          <div style="margin-top: 6px; font-size: 10px; color: var(--muted);">Example: 0x000…dEaD · address must start with 0x and be 42 chars</div>
        </div>
        <div class="claude-modal-actions">
          <button class="claude-btn" id="wallet-cancel">Cancel</button>
          <button class="claude-btn primary" id="wallet-ok">View Ponks</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const input = backdrop.querySelector('#wallet-addr-input') as HTMLInputElement;
    input.focus();
    const close = (value: string | null) => {
      backdrop.remove();
      resolve(value);
    };
    backdrop.querySelector('#wallet-cancel')?.addEventListener('click', () => close(null));
    backdrop.querySelector('#wallet-ok')?.addEventListener('click', () => close(input.value || null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value || null);
      if (e.key === 'Escape') close(null);
    });
  });
}

async function ensurePulseChain() {
  const eth = window.ethereum;
  if (!eth) return;
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x171' }], // 369
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4902) {
      // Chain not added — add it.
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: '0x171',
            chainName: 'PulseChain',
            nativeCurrency: { name: 'Pulse', symbol: 'PLS', decimals: 18 },
            rpcUrls: ['https://rpc.pulsechain.com'],
            blockExplorerUrls: ['https://scan.pulsechain.com'],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function fetchPonks(owner: Address): Promise<Ponk[]> {
  const balance = (await publicClient.readContract({
    address: PONKS_CONTRACT,
    abi: ERC721_ABI,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint;

  const count = Number(balance);
  if (count === 0) return [];

  // Try Enumerable first — far cheaper than scanning Transfer events.
  let supportsEnum = false;
  try {
    supportsEnum = (await publicClient.readContract({
      address: PONKS_CONTRACT,
      abi: ERC721_ABI,
      functionName: 'supportsInterface',
      args: ['0x780e9d63'],
    })) as boolean;
  } catch {
    supportsEnum = false;
  }
  if (!supportsEnum) {
    console.warn('[ponks] contract not Enumerable; fetching by event scan is unimplemented in v1.');
    return [];
  }

  const tokenIds = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      publicClient.readContract({
        address: PONKS_CONTRACT,
        abi: ERC721_ABI,
        functionName: 'tokenOfOwnerByIndex',
        args: [owner, BigInt(i)],
      }) as Promise<bigint>,
    ),
  );

  const ponks = await Promise.all(
    tokenIds.map(async (id) => {
      const cached = await readCache(id);
      if (cached) return cached;
      const uri = (await publicClient.readContract({
        address: PONKS_CONTRACT,
        abi: ERC721_ABI,
        functionName: 'tokenURI',
        args: [id],
      })) as string;
      const meta = await fetchMetadata(uri);
      const ponk: Ponk = {
        tokenId: id,
        tokenURI: uri,
        imageUrl: meta?.image ? resolveIpfs(meta.image) : undefined,
        name: meta?.name,
      };
      await writeCache(ponk);
      return ponk;
    }),
  );

  return ponks;
}

async function fetchMetadata(uri: string): Promise<{ image?: string; name?: string } | null> {
  const url = resolveIpfs(uri);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as { image?: string; name?: string };
  } catch {
    return null;
  }
}

const IPFS_GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

function resolveIpfs(url: string): string {
  if (url.startsWith('ipfs://')) {
    const path = url.slice('ipfs://'.length).replace(/^ipfs\//, '');
    // First gateway — for image URLs, the racing strategy is overkill since
    // browsers cache. Single CORS-friendly gateway suffices for v1.
    return `${IPFS_GATEWAYS[0]}${path}`;
  }
  return url;
}

// --- IndexedDB cache (NFT metadata is immutable, cache forever) -----------

const DB_NAME = 'hairy-ponks';
const STORE = 'tokens';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'tokenId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCache(id: bigint): Promise<Ponk | null> {
  try {
    const db = await openDB();
    return await new Promise<Ponk | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id.toString());
      req.onsuccess = () => resolve((req.result as Ponk) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeCache(p: Ponk): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...p, tokenId: p.tokenId.toString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}
