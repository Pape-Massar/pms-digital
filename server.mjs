import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const downloadDir = path.join(root, 'private-downloads');
const uploadDir = path.join(dataDir, 'uploads');
mkdirSync(dataDir, { recursive: true });
mkdirSync(downloadDir, { recursive: true });
mkdirSync(uploadDir, { recursive: true });

const catalog = [
  { id: 'cv-modern', family: 'cv', name: 'CV moderne', price: 3000, icon: '📄', description: 'Un modèle de CV moderne et facile à personnaliser.' },
  { id: 'cv-student', family: 'cv', name: 'CV étudiant', price: 3000, icon: '📄', description: 'Un modèle clair pour présenter un premier parcours.' },
  { id: 'cv-executive', family: 'cv', name: 'CV cadre', price: 3000, icon: '📄', description: 'Un modèle professionnel pour les profils expérimentés.' },
  { id: 'cv-creative', family: 'cv', name: 'Pack de modèles de CV', price: 3000, icon: '📄', description: 'Des mises en page prêtes à adapter à votre profil.' },
  { id: 'letter-general', family: 'letters', name: 'Lettre de motivation classique', price: 2000, icon: '✉️', description: 'Une trame professionnelle pour votre candidature.' },
  { id: 'letter-internship', family: 'letters', name: 'Lettre de candidature pour un stage', price: 2000, icon: '✉️', description: 'Un modèle simple pour préparer une demande de stage.' },
  { id: 'guide-business', family: 'books', name: 'Guide pour entreprendre au Sénégal', price: 2500, icon: '📚', description: 'Les premières étapes pour structurer un projet.' },
  { id: 'guide-marketing', family: 'books', name: 'Guide pratique du marketing', price: 2500, icon: '📚', description: 'Les notions essentielles pour faire connaître une activité.' },
  { id: 'doc-invoice', family: 'documents', name: 'Modèle de facture professionnelle', price: 5000, icon: '💼', description: 'Un document prêt à personnaliser pour votre activité.' },
  { id: 'doc-business-plan', family: 'documents', name: 'Modèle de business plan', price: 5000, icon: '💼', description: 'Une structure pour présenter et organiser votre projet.' },
  { id: 'training-word', family: 'training', name: 'Formation Microsoft Word', price: 15000, icon: '📝', description: 'Apprenez à créer et mettre en forme des documents dans Word.', is_course: 1 },
  { id: 'training-excel', family: 'training', name: 'Formation Microsoft Excel', price: 15000, icon: '📊', description: 'Maîtrisez les tableaux, formules et fonctions utiles d’Excel.', is_course: 1 },
  { id: 'training-autocad', family: 'training', name: 'Formation AutoCAD', price: 15000, icon: '📐', description: 'Découvrez les bases du dessin assisté par ordinateur avec AutoCAD.', is_course: 1 },
  { id: 'training-web', family: 'training', name: 'Développement web pour débutants', price: 15000, icon: '💻', description: 'Faites vos premiers pas en HTML, CSS et JavaScript.', is_course: 1 },
  { id: 'training-canva', family: 'training', name: 'Formation Canva', price: 15000, icon: '🎨', description: 'Créez des visuels et supports de communication avec Canva.', is_course: 1 },
  { id: 'training-cybersecurity', family: 'training', name: 'Initiation à la cybersécurité', price: 15000, icon: '🔐', description: 'Adoptez les bons réflexes pour protéger vos comptes et données.', is_course: 1 },
  { id: 'training-ai', family: 'training', name: 'Découvrir l’intelligence artificielle', price: 15000, icon: '🤖', description: 'Comprenez les usages pratiques des outils d’intelligence artificielle.', is_course: 1 },
  { id: 'training-business-creation', family: 'training', name: 'Comment créer sa propre entreprise', price: 15000, icon: '🚀', description: 'Structurez une idée et préparez les premières étapes de création.', is_course: 1 },
  { id: 'training-entrepreneurship', family: 'training', name: 'Les bases de l’entrepreneuriat', price: 15000, icon: '💡', description: 'Découvrez les principes utiles pour développer une activité.', is_course: 1 },
  { id: 'training-campus-france', family: 'training', name: 'Parcoursup et Campus France : le guide', price: 15000, icon: '🎓', description: 'Préparez vos démarches de candidature et votre dossier étudiant.', is_course: 1 }
];

const db = new DatabaseSync(path.join(dataDir, 'store.sqlite'));
const transaction = callback => {
  db.exec('BEGIN');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'fr',
    currency TEXT NOT NULL DEFAULT 'XOF',
    country TEXT NOT NULL DEFAULT 'SN',
    role TEXT NOT NULL DEFAULT 'customer',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    invoice_token TEXT UNIQUE,
    total INTEGER NOT NULL,
    status TEXT NOT NULL,
    product_ids TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    family TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    icon TEXT NOT NULL DEFAULT '📦',
    description TEXT NOT NULL DEFAULT '',
    is_course INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    thumbnail_file TEXT,
    delivery_file TEXT
  );
  CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    video_url TEXT,
    video_file TEXT,
    UNIQUE(product_id, position)
  );
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    price INTEGER NOT NULL,
    delivery_file TEXT,
    is_course INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (order_id, product_id)
  );
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
if (!userColumns.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'");
db.exec('CREATE INDEX IF NOT EXISTS lessons_product_position ON lessons (product_id, position)');

if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count === 0) {
  const insertProduct = db.prepare(`INSERT INTO products
    (id, family, name, price, icon, description, is_course) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertLesson = db.prepare('INSERT INTO lessons (product_id, position, title) VALUES (?, ?, ?)');
  const seed = () => transaction(() => {
    for (const product of catalog) {
      insertProduct.run(product.id, product.family, product.name, product.price, product.icon, product.description, product.is_course || 0);
      if (product.is_course) {
        for (let position = 1; position <= 15; position++) {
          insertLesson.run(product.id, position, `Leçon ${position}`);
        }
      }
    }
  });
  seed();
}

const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
if (adminEmail) {
  let admin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!admin && process.env.ADMIN_INITIAL_PASSWORD) {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(process.env.ADMIN_INITIAL_PASSWORD, salt, 64)).toString('hex');
    const result = db.prepare("INSERT INTO users (email, password_hash, password_salt, role) VALUES (?, ?, ?, 'admin')")
      .run(adminEmail, passwordHash, salt);
    admin = { id: result.lastInsertRowid };
  }
  if (admin) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
}

const secureCookie = process.env.APP_BASE_URL?.startsWith('https://') ?? false;
const cookieBase = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 14}${secureCookie ? '; Secure' : ''}`;
const parseCookies = header => Object.fromEntries((header || '').split(';').map(part => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
}).filter(([key]) => key));
const hashToken = token => createHash('sha256').update(token).digest('hex');
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
};

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 32_000) throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 });
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('JSON invalide.'), { status: 400 });
  }
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).pms_session;
  if (!token) return null;
  const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(token), Date.now());
  if (!session) return null;
  return db.prepare('SELECT id, email, language, currency, country, role FROM users WHERE id = ?').get(session.user_id) || null;
}

function publicUser(user) {
  return { email: user.email, language: user.language, currency: user.currency, country: user.country, role: user.role };
}

async function createSession(userId, res) {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, Date.now() + 14 * 24 * 60 * 60 * 1000);
  res.setHeader('Set-Cookie', `pms_session=${encodeURIComponent(token)}; ${cookieBase}`);
}

function paydunyaConfigured() {
  return ['PAYDUNYA_MASTER_KEY', 'PAYDUNYA_PRIVATE_KEY', 'PAYDUNYA_TOKEN', 'APP_BASE_URL']
    .every(key => Boolean(process.env[key]));
}

function paydunyaBaseUrl() {
  return process.env.PAYDUNYA_MODE === 'live'
    ? 'https://app.paydunya.com/api/v1'
    : 'https://app.paydunya.com/sandbox-api/v1';
}

function paydunyaHeaders() {
  return {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_MASTER_KEY,
    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
    'PAYDUNYA-TOKEN': process.env.PAYDUNYA_TOKEN
  };
}

async function confirmInvoice(token) {
  const response = await fetch(`${paydunyaBaseUrl()}/checkout-invoice/confirm/${encodeURIComponent(token)}`, {
    headers: paydunyaHeaders(),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || result.response_code !== '00') throw new Error('PayDunya n’a pas pu confirmer cette facture.');
  return result;
}

function syncOrderPayment(order, invoice) {
  if (invoice.status !== 'completed') return false;
  if (Number(invoice.invoice?.total_amount) !== order.total) throw new Error('Le montant confirmé ne correspond pas à la commande.');
  db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'").run(order.id);
  return true;
}

function requireAdmin(req, res) {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: 'Connectez-vous avec le compte administrateur.' });
    return null;
  }
  if (user.role !== 'admin') {
    json(res, 403, { error: 'Accès réservé à l’administrateur.' });
    return null;
  }
  return user;
}

function productRows({ includeInactive = false } = {}) {
  const activeClause = includeInactive ? '' : 'WHERE p.is_active = 1';
  return db.prepare(`SELECT p.*,
    (SELECT COUNT(*) FROM lessons l WHERE l.product_id = p.id) AS lesson_count,
    (SELECT COUNT(*) FROM lessons l WHERE l.product_id = p.id AND (l.video_url IS NOT NULL OR l.video_file IS NOT NULL)) AS ready_lessons
    FROM products p ${activeClause} ORDER BY p.is_course DESC, p.id`).all();
}

function publicProduct(product) {
  return {
    id: product.id,
    family: product.family,
    name: product.name,
    price: product.price,
    icon: product.icon,
    description: product.description,
    isCourse: Boolean(product.is_course),
    active: Boolean(product.is_active),
    lessonCount: product.lesson_count || 0,
    readyLessons: product.ready_lessons || 0,
    thumbnailUrl: product.thumbnail_file ? `/api/products/${encodeURIComponent(product.id)}/thumbnail` : null
  };
}

function validVideoUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error('Saisissez une URL vidéo complète.'), { status: 400 });
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw Object.assign(new Error('Les vidéos par URL doivent utiliser une adresse HTTPS.'), { status: 400 });
  }
  return url.href;
}

const mimeExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov'
};

const assetTypes = {
  thumbnail: { mimes: ['image/jpeg', 'image/png', 'image/webp'], max: 10 * 1024 * 1024 },
  product: { mimes: ['application/pdf', 'application/zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], max: 250 * 1024 * 1024 },
  video: { mimes: ['video/mp4', 'video/webm', 'video/quicktime'], max: 2 * 1024 * 1024 * 1024 }
};

async function receiveUpload(req, kind) {
  const policy = assetTypes[kind];
  if (!policy) throw Object.assign(new Error('Type de fichier inconnu.'), { status: 400 });
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > policy.max + 1024 * 1024) throw Object.assign(new Error('Le fichier dépasse la taille maximale autorisée.'), { status: 413 });
  const pendingWrites = [];
  let uploaded = null;
  let uploadError = null;
  let fileCount = 0;
  let parser;
  try {
    parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: policy.max, fields: 4, fieldSize: 2000 } });
  } catch {
    throw Object.assign(new Error('Formulaire de téléversement invalide.'), { status: 400 });
  }
  parser.on('file', (field, stream, info) => {
    fileCount++;
    if (field !== 'file' || fileCount > 1 || !policy.mimes.includes(info.mimeType)) {
      uploadError = new Error('Ce type de fichier ne peut pas être téléversé ici.');
      stream.resume();
      return;
    }
    const storedName = `${randomBytes(24).toString('hex')}${mimeExtensions[info.mimeType]}`;
    const target = path.join(uploadDir, storedName);
    uploaded = { file: storedName, mimeType: info.mimeType, originalName: path.basename(info.filename).slice(0, 180) };
    stream.on('limit', () => {
      uploadError = Object.assign(new Error('Le fichier dépasse la taille maximale autorisée.'), { status: 413 });
    });
    pendingWrites.push(pipeline(stream, createWriteStream(target, { flags: 'wx' })));
  });
  try {
    await pipeline(req, parser);
    await Promise.all(pendingWrites);
  } catch (error) {
    if (uploaded) {
      const target = path.join(uploadDir, uploaded.file);
      if (existsSync(target)) unlinkSync(target);
    }
    throw uploadError || Object.assign(new Error('Le téléversement a échoué.'), { status: 400 });
  }
  if (uploadError || !uploaded) {
    if (uploaded) {
      const target = path.join(uploadDir, uploaded.file);
      if (existsSync(target)) unlinkSync(target);
    }
    throw uploadError || Object.assign(new Error('Sélectionnez un fichier à téléverser.'), { status: 400 });
  }
  const target = path.join(uploadDir, uploaded.file);
  const headerBuffer = Buffer.alloc(16);
  const fd = openSync(target, 'r');
  let bytesRead;
  try {
    bytesRead = readSync(fd, headerBuffer, 0, headerBuffer.length, 0);
  } finally {
    closeSync(fd);
  }
  const header = headerBuffer.subarray(0, bytesRead);
  const validSignature = uploaded.mimeType === 'image/png' ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : uploaded.mimeType === 'image/jpeg' ? header[0] === 255 && header[1] === 216 && header[2] === 255
      : uploaded.mimeType === 'image/webp' ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
        : uploaded.mimeType === 'application/pdf' ? header.toString('ascii', 0, 5) === '%PDF-'
          : uploaded.mimeType.startsWith('video/') ? (header.toString('ascii', 4, 8) === 'ftyp' || header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
            : uploaded.mimeType.startsWith('application/vnd.openxmlformats-officedocument.') || uploaded.mimeType === 'application/zip'
              ? header[0] === 0x50 && header[1] === 0x4b
              : false;
  if (!validSignature) {
    unlinkSync(target);
    throw Object.assign(new Error('Le contenu du fichier ne correspond pas au format annoncé.'), { status: 400 });
  }
  return uploaded;
}

function purchasedCourse(user, productId) {
  if (user.role === 'admin') return true;
  return Boolean(db.prepare(`SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
    WHERE o.user_id = ? AND o.status = 'paid' AND i.product_id = ?`).get(user.id, productId));
}

function streamPrivateVideo(req, res, storedName) {
  const filePath = path.resolve(uploadDir, storedName);
  if (!filePath.startsWith(uploadDir + path.sep) || !existsSync(filePath)) return json(res, 404, { error: 'Vidéo introuvable.' });
  const size = statSync(filePath).size;
  const mimeType = path.extname(filePath).toLowerCase() === '.webm' ? 'video/webm'
    : path.extname(filePath).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';
  const range = req.headers.range;
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { 'Content-Type': mimeType, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return createReadStream(filePath, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  return createReadStream(filePath).pipe(res);
}

async function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/products') {
    return json(res, 200, { products: productRows().map(publicProduct) });
  }

  const thumbnailMatch = url.pathname.match(/^\/api\/products\/([a-z0-9-]+)\/thumbnail$/);
  if (req.method === 'GET' && thumbnailMatch) {
    const product = db.prepare('SELECT thumbnail_file FROM products WHERE id = ? AND is_active = 1').get(thumbnailMatch[1]);
    if (!product?.thumbnail_file) return json(res, 404, { error: 'Miniature indisponible.' });
    const filePath = path.resolve(uploadDir, product.thumbnail_file);
    if (!filePath.startsWith(uploadDir + path.sep) || !existsSync(filePath)) return json(res, 404, { error: 'Miniature indisponible.' });
    const mimeType = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(filePath)];
    res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    return createReadStream(filePath).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    const user = currentUser(req);
    return json(res, 200, { user: user ? publicUser(user) : null, adminConfigured: Boolean(adminEmail) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/products') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const products = productRows({ includeInactive: true }).map(product => ({
      ...publicProduct(product),
      active: Boolean(product.is_active),
      hasThumbnail: Boolean(product.thumbnail_file),
      hasDeliveryFile: Boolean(product.delivery_file),
      lessons: db.prepare('SELECT position, title, video_url, video_file FROM lessons WHERE product_id = ? ORDER BY position').all(product.id)
        .map(lesson => ({ ...lesson, hasVideo: Boolean(lesson.video_url || lesson.video_file) }))
    }));
    return json(res, 200, { products, maxActiveProducts: 20 });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/products') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readJson(req);
    const name = String(body.name || '').trim();
    const family = String(body.family || '').trim();
    const price = Number(body.price);
    const icon = String(body.icon || '📦').trim().slice(0, 8);
    const description = String(body.description || '').trim();
    if (!name || name.length > 160 || !['cv', 'letters', 'books', 'documents', 'training'].includes(family)
      || !Number.isSafeInteger(price) || price < 1 || price > 2_000_000_000 || description.length > 2000) {
      return json(res, 400, { error: 'Vérifiez le nom, la catégorie, le prix et la description.' });
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM products WHERE is_active = 1').get().count >= 20) {
      return json(res, 409, { error: 'La boutique est limitée à 20 fiches actives. Archivez une fiche avant d’en créer une autre.' });
    }
    const id = `custom-${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${randomBytes(4).toString('hex')}`;
    const isCourse = family === 'training';
    const insertProduct = db.prepare('INSERT INTO products (id, family, name, price, icon, description, is_course) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertLesson = db.prepare('INSERT INTO lessons (product_id, position, title) VALUES (?, ?, ?)');
    transaction(() => {
      insertProduct.run(id, family, name, price, icon, description, Number(isCourse));
      if (isCourse) {
        for (let position = 1; position <= 15; position++) insertLesson.run(id, position, `Leçon ${position}`);
      }
    });
    return json(res, 201, { product: publicProduct(db.prepare('SELECT p.*, 0 AS lesson_count FROM products p WHERE id = ?').get(id)) });
  }

  const adminProductMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)$/);
  if (adminProductMatch && req.method === 'PUT') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const body = await readJson(req);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(adminProductMatch[1]);
    if (!product) return json(res, 404, { error: 'Produit introuvable.' });
    const name = String(body.name ?? product.name).trim();
    const family = String(body.family ?? product.family).trim();
    const price = Number(body.price ?? product.price);
    const icon = String(body.icon ?? product.icon).trim().slice(0, 8);
    const description = String(body.description ?? product.description).trim();
    const active = body.active === undefined ? Boolean(product.is_active) : Boolean(body.active);
    if (!name || name.length > 160 || !['cv', 'letters', 'books', 'documents', 'training'].includes(family)
      || !Number.isSafeInteger(price) || price < 1 || price > 2_000_000_000 || description.length > 2000) {
      return json(res, 400, { error: 'Vérifiez le nom, la catégorie, le prix et la description.' });
    }
    if (active && !product.is_active && db.prepare('SELECT COUNT(*) AS count FROM products WHERE is_active = 1').get().count >= 20) {
      return json(res, 409, { error: 'La boutique est limitée à 20 fiches actives.' });
    }
    const isCourse = family === 'training';
    db.prepare('UPDATE products SET family = ?, name = ?, price = ?, icon = ?, description = ?, is_course = ?, is_active = ? WHERE id = ?')
      .run(family, name, price, icon, description, Number(isCourse), Number(active), product.id);
    if (isCourse && !product.is_course) {
      const lessonCount = db.prepare('SELECT COUNT(*) AS count FROM lessons WHERE product_id = ?').get(product.id).count;
      const insertLesson = db.prepare('INSERT INTO lessons (product_id, position, title) VALUES (?, ?, ?)');
      for (let position = lessonCount + 1; position <= 15; position++) insertLesson.run(product.id, position, `Leçon ${position}`);
    }
    return json(res, 200, { product: publicProduct(db.prepare('SELECT p.*, (SELECT COUNT(*) FROM lessons WHERE product_id = p.id) AS lesson_count FROM products p WHERE p.id = ?').get(product.id)) });
  }

  const archiveProductMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)$/);
  if (archiveProductMatch && req.method === 'DELETE') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const result = db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(archiveProductMatch[1]);
    if (!result.changes) return json(res, 404, { error: 'Produit introuvable.' });
    return json(res, 200, { ok: true });
  }

  const uploadMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)\/upload$/);
  if (uploadMatch && req.method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(uploadMatch[1]);
    if (!product) return json(res, 404, { error: 'Produit introuvable.' });
    const kind = url.searchParams.get('kind');
    if (kind === 'product' && product.is_course) return json(res, 400, { error: 'Pour une formation, téléversez les vidéos dans les leçons.' });
    const upload = await receiveUpload(req, kind);
    const column = kind === 'thumbnail' ? 'thumbnail_file' : 'delivery_file';
    db.prepare(`UPDATE products SET ${column} = ? WHERE id = ?`).run(upload.file, product.id);
    return json(res, 200, { ok: true, filename: upload.originalName });
  }

  const lessonManageMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)\/lessons$/);
  if (lessonManageMatch && req.method === 'PUT') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const product = db.prepare('SELECT id, is_course FROM products WHERE id = ?').get(lessonManageMatch[1]);
    if (!product || !product.is_course) return json(res, 404, { error: 'Formation introuvable.' });
    const body = await readJson(req);
    if (!Array.isArray(body.lessons) || body.lessons.length < 15 || body.lessons.length > 20) {
      return json(res, 400, { error: 'Chaque formation doit contenir entre 15 et 20 leçons.' });
    }
    const current = db.prepare('SELECT position, video_file FROM lessons WHERE product_id = ?').all(product.id);
    const oldFiles = new Map(current.map(lesson => [lesson.position, lesson.video_file]));
    const normalized = [];
    for (const [index, lesson] of body.lessons.entries()) {
      const title = String(lesson.title || '').trim();
      if (!title || title.length > 140) return json(res, 400, { error: `Le titre de la leçon ${index + 1} est obligatoire (140 caractères maximum).` });
      let videoUrl;
      try {
        videoUrl = validVideoUrl(String(lesson.videoUrl || '').trim());
      } catch (error) {
        return json(res, error.status || 400, { error: `Leçon ${index + 1} : ${error.message}` });
      }
      normalized.push({ position: index + 1, title, videoUrl, videoFile: videoUrl ? null : oldFiles.get(index + 1) || null });
    }
    const updateLessons = () => transaction(() => {
      db.prepare('DELETE FROM lessons WHERE product_id = ?').run(product.id);
      const insert = db.prepare('INSERT INTO lessons (product_id, position, title, video_url, video_file) VALUES (?, ?, ?, ?, ?)');
      for (const lesson of normalized) insert.run(product.id, lesson.position, lesson.title, lesson.videoUrl, lesson.videoFile);
    });
    updateLessons();
    return json(res, 200, { ok: true, lessons: normalized.map(({ position, title, videoUrl, videoFile }) => ({ position, title, videoUrl, hasVideo: Boolean(videoUrl || videoFile) })) });
  }

  const videoUploadMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)\/lessons\/(\d+)\/upload$/);
  if (videoUploadMatch && req.method === 'POST') {
    const user = requireAdmin(req, res);
    if (!user) return;
    const position = Number(videoUploadMatch[2]);
    const lesson = db.prepare('SELECT id FROM lessons WHERE product_id = ? AND position = ?').get(videoUploadMatch[1], position);
    if (!lesson) return json(res, 404, { error: 'Leçon introuvable.' });
    const upload = await receiveUpload(req, 'video');
    db.prepare('UPDATE lessons SET video_file = ?, video_url = NULL WHERE id = ?').run(upload.file, lesson.id);
    return json(res, 200, { ok: true, filename: upload.originalName });
  }

  const lessonUploadMatch = url.pathname.match(/^\/api\/admin\/products\/([a-z0-9-]+)\/lessons\/(\d+)\/playback$/);
  if (lessonUploadMatch && req.method === 'GET') {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Connectez-vous pour suivre cette formation.' });
    const productId = lessonUploadMatch[1];
    if (!purchasedCourse(user, productId)) return json(res, 403, { error: 'Achetez cette formation pour accéder aux leçons.' });
    const lesson = db.prepare('SELECT video_url, video_file FROM lessons WHERE product_id = ? AND position = ?').get(productId, Number(lessonUploadMatch[2]));
    if (!lesson) return json(res, 404, { error: 'Leçon introuvable.' });
    if (lesson.video_file) return streamPrivateVideo(req, res, lesson.video_file);
    if (lesson.video_url) return json(res, 200, { videoUrl: lesson.video_url });
    return json(res, 404, { error: 'Cette leçon est en préparation.' });
  }

  const courseMatch = url.pathname.match(/^\/api\/courses\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && courseMatch) {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Connectez-vous pour consulter vos formations.' });
    const product = db.prepare('SELECT id, name, is_course FROM products WHERE id = ? AND is_active = 1').get(courseMatch[1]);
    if (!product?.is_course) return json(res, 404, { error: 'Formation introuvable.' });
    if (!purchasedCourse(user, product.id)) return json(res, 403, { error: 'Achetez cette formation pour accéder aux leçons.' });
    const lessons = db.prepare('SELECT position, title, video_url, video_file FROM lessons WHERE product_id = ? ORDER BY position').all(product.id);
    return json(res, 200, { course: { name: product.name, lessons: lessons.map(lesson => ({ position: lesson.position, title: lesson.title, ready: Boolean(lesson.video_url || lesson.video_file) })) } });
  }

  if (req.method === 'POST' && url.pathname === '/api/register') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const passwordConfirmation = String(body.passwordConfirmation || '');
    if (password !== passwordConfirmation) {
      return json(res, 400, { error: 'Les mots de passe ne correspondent pas.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
      return json(res, 400, { error: 'Saisissez un e-mail valide et un mot de passe de 8 caractères minimum.' });
    }
    if (adminEmail && email === adminEmail && !db.prepare('SELECT id FROM users WHERE email = ? AND role = ?').get(adminEmail, 'admin')) {
      return json(res, 403, { error: 'Le compte administrateur doit être initialisé depuis les variables sécurisées du serveur.' });
    }
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    try {
      const result = db.prepare('INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)').run(email, passwordHash, salt);
      const user = db.prepare('SELECT id, email, language, currency, country, role FROM users WHERE id = ?').get(result.lastInsertRowid);
      await createSession(user.id, res);
      return json(res, 201, { user: publicUser(user) });
    } catch (error) {
      if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') return json(res, 409, { error: 'Cette adresse e-mail a déjà un compte.' });
      throw error;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.prepare('SELECT id, email, password_hash, password_salt, language, currency, country, role FROM users WHERE email = ?').get(email);
    const supplied = (await scrypt(password, user?.password_salt || 'invalid-account-salt', 64)).toString('hex');
    if (!user || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(user.password_hash, 'hex'))) {
      return json(res, 401, { error: 'Adresse e-mail ou mot de passe incorrect.' });
    }
    await createSession(user.id, res);
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = parseCookies(req.headers.cookie).pms_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'pms_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Connectez-vous pour enregistrer vos réglages.' });
    const body = await readJson(req);
    const allowed = { language: ['fr', 'en'], currency: ['XOF', 'EUR', 'USD'], country: ['SN', 'CI', 'ML', 'BF', 'BJ', 'TG', 'FR'] };
    if (!allowed.language.includes(body.language) || !allowed.currency.includes(body.currency) || !allowed.country.includes(body.country)) {
      return json(res, 400, { error: 'Réglages invalides.' });
    }
    db.prepare('UPDATE users SET language = ?, currency = ?, country = ? WHERE id = ?').run(body.language, body.currency, body.country, user.id);
    return json(res, 200, { user: publicUser({ ...user, ...body }) });
  }

  if (req.method === 'GET' && url.pathname === '/api/orders') {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Connectez-vous pour consulter vos achats.' });
    const orders = db.prepare('SELECT id, total, status, product_ids, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
    return json(res, 200, { orders: orders.map(order => ({
      id: order.id,
      total: order.total,
      status: order.status,
      createdAt: order.created_at,
      products: db.prepare('SELECT product_id AS id, product_name AS name, price, is_course FROM order_items WHERE order_id = ?').all(order.id)
        .map(item => ({ ...item, isCourse: Boolean(item.is_course) }))
    })) });
  }

  if (req.method === 'POST' && url.pathname === '/api/checkout') {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Connectez-vous avant de payer.' });
    if (!paydunyaConfigured()) return json(res, 503, { error: 'Le paiement PayDunya n’est pas encore configuré sur le serveur.' });
    const body = await readJson(req);
    const ids = Array.isArray(body.productIds) ? [...new Set(body.productIds)] : [];
    if (!ids.length || ids.length > 20 || ids.some(id => typeof id !== 'string')) return json(res, 400, { error: 'Sélection de produits invalide.' });
    const products = ids.map(id => db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(id));
    if (products.some(product => !product)) return json(res, 400, { error: 'Un produit de votre panier n’est plus disponible.' });
    for (const product of products) {
      if (product.is_course) {
        const lessonStatus = db.prepare(`SELECT COUNT(*) AS total,
          SUM(CASE WHEN video_url IS NOT NULL OR video_file IS NOT NULL THEN 1 ELSE 0 END) AS ready
          FROM lessons WHERE product_id = ?`).get(product.id);
        if (lessonStatus.total < 15 || lessonStatus.total > 20 || lessonStatus.ready !== lessonStatus.total) {
          return json(res, 503, { error: `La formation « ${product.name} » doit avoir 15 à 20 vidéos prêtes avant sa mise en vente.` });
        }
      } else {
        const filePath = product.delivery_file ? path.resolve(uploadDir, product.delivery_file) : '';
        if (!filePath || !filePath.startsWith(uploadDir + path.sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          return json(res, 503, { error: `Le fichier de livraison de « ${product.name} » doit être téléversé par l’administrateur.` });
        }
      }
    }

    const orderId = randomBytes(16).toString('hex');
    const total = products.reduce((sum, product) => sum + product.price, 0);
    const appUrl = process.env.APP_BASE_URL.replace(/\/$/, '');
    const items = Object.fromEntries(products.map((product, index) => [`item_${index + 1}`, {
      name: product.name,
      quantity: 1,
      unit_price: product.price,
      total_price: product.price,
      description: 'Produit numérique, disponible dans le compte après paiement confirmé.'
    }]));
    const payload = {
      invoice: { total_amount: total, description: `Commande PMS-Digital ${orderId.slice(0, 8)}`, items },
      store: { name: 'PMS-Digital', tagline: 'Le numérique à portée de clic', phone_number: '+221768642951', website_url: appUrl },
      actions: {
        return_url: `${appUrl}/?paiement=retour&order=${orderId}`,
        cancel_url: `${appUrl}/?paiement=annule`,
        callback_url: `${appUrl}/api/paydunya/callback`
      },
      custom_data: { order_id: orderId }
    };
    const response = await fetch(`${paydunyaBaseUrl()}/checkout-invoice/create`, {
      method: 'POST',
      headers: paydunyaHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok || result.response_code !== '00' || !result.token || !result.response_text) {
      console.error('PayDunya checkout creation failed:', result.response_text || result.response_code || response.status);
      return json(res, 502, { error: 'PayDunya n’a pas pu créer la facture. Réessayez plus tard.' });
    }
    const checkoutUrl = new URL(result.response_text);
    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'app.paydunya.com') {
      return json(res, 502, { error: 'PayDunya a renvoyé une adresse de paiement invalide.' });
    }
    transaction(() => {
      db.prepare('INSERT INTO orders (id, user_id, invoice_token, total, status, product_ids) VALUES (?, ?, ?, ?, ?, ?)')
        .run(orderId, user.id, result.token, total, 'pending', JSON.stringify(ids));
      const addOrderItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, price, delivery_file, is_course) VALUES (?, ?, ?, ?, ?, ?)');
      for (const product of products) {
        addOrderItem.run(orderId, product.id, product.name, product.price, product.delivery_file, product.is_course);
      }
    });
    return json(res, 200, { checkoutUrl: checkoutUrl.href });
  }

  if (req.method === 'POST' && url.pathname === '/api/paydunya/callback') {
    if (!paydunyaConfigured()) return json(res, 503, { error: 'Paiement non configuré.' });
    const body = await readJson(req);
    const token = String(body.token || body.invoice_token || body.data?.token || body.data?.invoice?.token || '');
    if (!token) return json(res, 400, { error: 'Jeton de facture absent.' });
    const order = db.prepare('SELECT id, total, status FROM orders WHERE invoice_token = ?').get(token);
    if (!order) return json(res, 404, { error: 'Commande introuvable.' });
    const invoice = await confirmInvoice(token);
    syncOrderPayment(order, invoice);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/payments/confirm') {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Connectez-vous pour vérifier le paiement.' });
    const body = await readJson(req);
    const order = db.prepare('SELECT id, user_id, invoice_token, total, status FROM orders WHERE id = ? AND user_id = ?').get(String(body.orderId || ''), user.id);
    if (!order) return json(res, 404, { error: 'Commande introuvable.' });
    if (order.status === 'pending') {
      const invoice = await confirmInvoice(order.invoice_token);
      syncOrderPayment(order, invoice);
    }
    return json(res, 200, { status: db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id).status });
  }

  const downloadMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9]+)\/download\/([a-z0-9-]+)$/);
  if (req.method === 'GET' && downloadMatch) {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Connectez-vous pour télécharger vos achats.' });
    const orderItem = db.prepare(`SELECT i.delivery_file, i.is_course FROM order_items i
      JOIN orders o ON o.id = i.order_id WHERE o.id = ? AND o.user_id = ? AND o.status = 'paid' AND i.product_id = ?`)
      .get(downloadMatch[1], user.id, downloadMatch[2]);
    if (!orderItem || orderItem.is_course || !orderItem.delivery_file) return json(res, 404, { error: 'Téléchargement indisponible.' });
    const filePath = path.resolve(uploadDir, orderItem.delivery_file);
    if (!filePath.startsWith(uploadDir + path.sep) || !existsSync(filePath) || !statSync(filePath).isFile()) return json(res, 404, { error: 'Fichier de livraison indisponible.' });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${downloadMatch[2]}${path.extname(filePath)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    return createReadStream(filePath).pipe(res);
  }
  return json(res, 404, { error: 'Route introuvable.' });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};
const publicImages = new Map([
  ['/image/WhatsApp Image 2026-10-23 at 12.34.32.jpeg', path.join(root, 'image', 'WhatsApp Image 2026-10-23 at 12.34.32.jpeg')],
  ['/image/WhatsApp Image 2026-10-23 at 12.45.01.jpeg', path.join(root, 'image', 'WhatsApp Image 2026-10-23 at 12.45.01.jpeg')]
]);

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const url = new URL(req.url, process.env.APP_BASE_URL || 'http://localhost:3000');
  try {
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Méthode non autorisée.' });
    const requested = decodeURIComponent(url.pathname);
    const imagePath = publicImages.get(requested);
    if (requested !== '/' && requested !== '/pms-digital.html' && !imagePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Page introuvable.');
    }
    const filePath = imagePath || path.join(root, 'pms-digital.html');
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Une erreur serveur est survenue.' });
    else res.destroy(error);
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`PMS-Digital disponible sur le port ${port}`));
