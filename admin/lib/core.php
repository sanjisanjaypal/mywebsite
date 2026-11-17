<?php
/* Storage, security and site operations for the Sanjay Pal CMS. No database: JSON files in /cms-data. */

require_once __DIR__ . '/bake.php';

define('CMS_ROOT', realpath(__DIR__ . '/../..'));
define('CMS_DATA', CMS_ROOT . '/cms-data');
define('CMS_UPLOADS', CMS_ROOT . '/uploads');
const CMS_HISTORY_KEEP = 60;
const CMS_MAX_UPLOAD = 20 * 1024 * 1024;
const CMS_LOCK_AFTER = 5;          // failed logins before a lock
const CMS_LOCK_MINUTES = 15;
const CMS_SESSION_HOURS = 8;
const CMS_MEDIA_TYPES = [
    'jpg' => ['image/jpeg'], 'jpeg' => ['image/jpeg'], 'png' => ['image/png'], 'webp' => ['image/webp'],
    'gif' => ['image/gif'], 'avif' => ['image/avif'], 'mp3' => ['audio/mpeg', 'audio/mp3'], 'pdf' => ['application/pdf'],
    'woff2' => ['font/woff2', 'application/octet-stream'],
];

/* ---------- files ---------- */
function cms_path(string $name): string { return CMS_DATA . '/' . $name; }

function cms_read(string $name, $fallback = []) {
    $f = cms_path($name);
    if (!is_file($f)) return $fallback;
    $h = fopen($f, 'r'); flock($h, LOCK_SH); $s = stream_get_contents($h); flock($h, LOCK_UN); fclose($h);
    $d = json_decode($s, true);
    return is_array($d) ? $d : $fallback;
}

function cms_write_file(string $path, string $data): void {
    $dir = dirname($path);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    $tmp = $path . '.tmp' . bin2hex(random_bytes(4));
    if (file_put_contents($tmp, $data, LOCK_EX) === false) throw new RuntimeException('Could not write ' . basename($path) . '. Check that the folder is writable.');
    if (!rename($tmp, $path)) { @unlink($tmp); throw new RuntimeException('Could not replace ' . basename($path) . '.'); }
}

function cms_write(string $name, $data): void {
    cms_write_file(cms_path($name), json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function cms_log(string $action, string $detail = ''): void {
    $u = $_SESSION['cms_user']['username'] ?? '-';
    $line = json_encode(['t' => date('c'), 'u' => $u, 'a' => $action, 'd' => mb_substr($detail, 0, 300), 'ip' => cms_ip()], JSON_UNESCAPED_UNICODE) . "\n";
    @file_put_contents(cms_path('activity.log'), $line, FILE_APPEND | LOCK_EX);
}

function cms_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'; }

/* ---------- sessions and auth ---------- */
function cms_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('spcms');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict']);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)(CMS_SESSION_HOURS * 3600));
    $dir = cms_path('sessions');
    if (!is_dir($dir)) @mkdir($dir, 0700, true);
    if (is_dir($dir) && is_writable($dir)) session_save_path($dir);
    session_start();
    if (!empty($_SESSION['cms_user']) && (time() - ($_SESSION['cms_seen'] ?? 0)) > CMS_SESSION_HOURS * 3600) {
        $_SESSION = []; session_regenerate_id(true);
    }
    if (!empty($_SESSION['cms_user'])) $_SESSION['cms_seen'] = time();
    if (empty($_SESSION['cms_csrf'])) $_SESSION['cms_csrf'] = bin2hex(random_bytes(32));
}

function cms_users(): array { return cms_read('users.json', []); }
function cms_needs_setup(): bool { return count(cms_users()) === 0; }

function cms_current_user(): ?array {
    $u = $_SESSION['cms_user'] ?? null;
    if (!$u) return null;
    foreach (cms_users() as $x) if ($x['id'] === $u['id']) return cms_public_user($x);
    return null;       // deleted while logged in
}

function cms_public_user(array $u): array {
    return ['id' => $u['id'], 'username' => $u['username'], 'name' => $u['name'] ?? $u['username'], 'role' => $u['role'],
            'created' => $u['created'] ?? null, 'lastLogin' => $u['lastLogin'] ?? null];
}

function cms_password_ok(string $p): ?string {
    if (strlen($p) < 10) return 'Use at least 10 characters.';
    if (!preg_match('/[A-Za-z]/', $p) || !preg_match('/[0-9]/', $p)) return 'Use letters and at least one number.';
    return null;
}

function cms_throttle_key(string $username): string { return hash('sha256', cms_ip() . '|' . strtolower($username)); }

function cms_locked(string $username): int {
    $t = cms_read('throttle.json', []); $k = cms_throttle_key($username);
    $until = $t[$k]['until'] ?? 0;
    return $until > time() ? $until - time() : 0;
}

function cms_note_failure(string $username): void {
    $t = cms_read('throttle.json', []); $k = cms_throttle_key($username); $now = time();
    foreach ($t as $kk => $v) if (($v['until'] ?? 0) < $now && ($v['last'] ?? 0) < $now - 86400) unset($t[$kk]);
    $c = ($t[$k]['count'] ?? 0) + 1;
    $t[$k] = ['count' => $c, 'last' => $now, 'until' => $c >= CMS_LOCK_AFTER ? $now + CMS_LOCK_MINUTES * 60 : 0];
    if ($c >= CMS_LOCK_AFTER) $t[$k]['count'] = 0;
    cms_write('throttle.json', $t);
}

function cms_clear_failures(string $username): void {
    $t = cms_read('throttle.json', []); unset($t[cms_throttle_key($username)]); cms_write('throttle.json', $t);
}

function cms_login(string $username, string $password): array {
    $wait = cms_locked($username);
    if ($wait) return ['ok' => false, 'error' => 'Too many attempts. Try again in ' . ceil($wait / 60) . ' minutes.'];
    $users = cms_users();
    foreach ($users as $i => $u) {
        if (strcasecmp($u['username'], $username) === 0 && password_verify($password, $u['hash'])) {
            if (password_needs_rehash($u['hash'], PASSWORD_DEFAULT)) $users[$i]['hash'] = password_hash($password, PASSWORD_DEFAULT);
            $users[$i]['lastLogin'] = date('c'); cms_write('users.json', $users);
            session_regenerate_id(true);
            $_SESSION['cms_user'] = ['id' => $u['id'], 'username' => $u['username']];
            $_SESSION['cms_seen'] = time();
            $_SESSION['cms_csrf'] = bin2hex(random_bytes(32));
            cms_clear_failures($username); cms_log('login');
            return ['ok' => true];
        }
    }
    password_verify($password, '$2y$10$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG'); // even out timing
    cms_note_failure($username); cms_log('login-failed', $username);
    return ['ok' => false, 'error' => 'That username and password do not match.'];
}

/* ---------- content ---------- */
function cms_defaults(): array { return cms_read('defaults.json', []); }
function cms_registry(): array { return cms_read('registry.json', []); }
function cms_settings(): array { return cms_read('settings.json', []); }
function cms_live(): array { return cms_read('live.json', ['rev' => 0]); }
function cms_draft(): array {
    $d = cms_read('draft.json', null);
    return is_array($d) ? $d : cms_live();
}

const CMS_INLINE_TAGS = ['a', 'b', 'strong', 'i', 'em', 'u', 'small', 'sup', 'sub', 'code', 'br', 'span', 'abbr', 'mark', 's', 'q', 'cite', 'time', 'kbd'];

/** Keep only inline formatting and safe links in rich text */
function cms_clean_html(string $html): string {
    if ($html === '' || !preg_match('/[<&]/', $html)) return $html;
    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="utf-8"?><div id="__r">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();
    $root = $doc->getElementById('__r');
    if (!$root) return htmlspecialchars(strip_tags($html), ENT_NOQUOTES, 'UTF-8');
    $walk = function (DOMNode $n) use (&$walk, $doc) {
        foreach (iterator_to_array($n->childNodes) as $c) {
            if ($c instanceof DOMComment) { $n->removeChild($c); continue; }
            if (!($c instanceof DOMElement)) continue;
            $tag = strtolower($c->nodeName);
            if (in_array($tag, ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template'], true)) { $n->removeChild($c); continue; }
            $walk($c);
            if (!in_array($tag, CMS_INLINE_TAGS, true)) {
                while ($c->firstChild) $n->insertBefore($c->firstChild, $c);
                $n->removeChild($c); continue;
            }
            foreach (iterator_to_array($c->attributes) as $a) {
                $name = strtolower($a->name); $keep = false;
                if ($name === 'class' && in_array($tag, ['span', 'a', 'b', 'strong', 'em', 'i'], true)) $keep = (bool)preg_match('/^[a-zA-Z0-9 _-]{0,120}$/', $a->value);
                if ($tag === 'a' && $name === 'href') $keep = cms_safe_url($a->value);
                if ($tag === 'a' && $name === 'target') $keep = in_array($a->value, ['_blank', '_top', '_self'], true);
                if ($tag === 'a' && $name === 'rel') $keep = true;
                if (in_array($name, ['title', 'aria-label', 'aria-hidden', 'lang', 'datetime'], true)) $keep = true;
                if (!$keep) $c->removeAttribute($a->name);
            }
            if ($tag === 'a' && $c->getAttribute('target') === '_blank') $c->setAttribute('rel', 'noopener');
        }
    };
    $walk($root);
    $out = '';
    foreach ($root->childNodes as $c) $out .= $doc->saveHTML($c);
    return $out;
}

function cms_safe_url(string $u): bool {
    $u = trim($u);
    if ($u === '' || $u[0] === '#' || $u[0] === '/' || $u[0] === '.') return true;
    if (preg_match('/^(https?:|mailto:|tel:)/i', $u)) return true;
    return !preg_match('/^[a-z][a-z0-9+.-]*:/i', $u);     // relative paths are fine; other schemes (javascript:) are not
}

function cms_clean_content(array $c): array {
    $out = ['t' => [], 'n' => [], 'a' => [], 'lists' => [], 'pages' => [], 'data' => []];
    foreach (($c['t'] ?? []) as $k => $v) if (is_string($k) && is_string($v)) $out['t'][$k] = cms_clean_html($v);
    foreach (($c['n'] ?? []) as $k => $v) if (is_string($k) && is_string($v)) $out['n'][$k] = mb_substr(strip_tags($v), 0, 2000);
    foreach (($c['a'] ?? []) as $k => $v) {
        if (!is_array($v)) continue;
        foreach ($v as $f => $val) {
            $val = (string)$val;
            if (!in_array($f, ['src', 'alt', 'width', 'height', 'href', 'tint', 'shape'], true)) continue;
            if (in_array($f, ['src', 'href'], true) && !cms_safe_url($val)) continue;
            if (in_array($f, ['width', 'height'], true) && $val !== '' && !ctype_digit($val)) continue;
            if ($f === 'tint' && !preg_match('/^#[0-9a-fA-F]{3,8}$/', $val)) continue;
            if ($f === 'shape' && !preg_match('/^[a-z]{0,20}$/', $val)) continue;
            $out['a'][$k][$f] = mb_substr($val, 0, 2000);
        }
    }
    foreach (($c['lists'] ?? []) as $k => $v) {
        if (!is_array($v)) continue;
        $ids = fn($a) => array_values(array_filter((array)$a, fn($x) => is_string($x) && strlen($x) < 300));
        $out['lists'][$k] = ['order' => $ids($v['order'] ?? []), 'hidden' => $ids($v['hidden'] ?? []), 'more' => $ids($v['more'] ?? [])];
    }
    foreach (($c['pages'] ?? []) as $f => $v) {
        if (!preg_match('/^[a-z0-9-]+\.html$/', $f) || !is_array($v)) continue;
        foreach (['title', 'description'] as $k) if (isset($v[$k])) $out['pages'][$f][$k] = mb_substr(strip_tags((string)$v[$k]), 0, 300);
    }
    $out['data'] = cms_clean_data($c['data'] ?? []);
    return $out;
}

/** Lists the pages draw at runtime: testimonials, process, principles, industries, map clients */
function cms_clean_data($d): array {
    $s = fn($v, $n = 2000) => mb_substr(trim(strip_tags((string)$v)), 0, $n);
    $o = [];
    if (isset($d['testimonials']) && is_array($d['testimonials'])) {
        $o['testimonials'] = [];
        foreach ($d['testimonials'] as $t) if (is_array($t) && $s($t['q'] ?? '') !== '')
            $o['testimonials'][] = ['q' => $s($t['q']), 'full' => $s($t['full'] ?? '', 5000), 'n' => $s($t['n'] ?? '', 120), 'r' => $s($t['r'] ?? '', 160)];
    }
    foreach (['process', 'principles'] as $k) if (isset($d[$k]) && is_array($d[$k])) {
        $o[$k] = [];
        foreach ($d[$k] as $t) if (is_array($t)) $o[$k][] = ['t' => $s($t['t'] ?? '', 160), 'd' => $s($t['d'] ?? '', 2000)];
    }
    if (isset($d['industries']) && is_array($d['industries'])) {
        $o['industries'] = [];
        foreach ($d['industries'] as $t) if (is_array($t) && $s($t[0] ?? '') !== '') $o['industries'][] = [$s($t[0], 80), preg_replace('/[^a-z]/', '', (string)($t[1] ?? 'gear'))];
    }
    if (isset($d['places']) && is_array($d['places'])) {
        $o['places'] = [];
        foreach ($d['places'] as $id => $names) if (preg_match('/^[a-z]{2,4}$/', (string)$id) && is_array($names))
            $o['places'][$id] = array_values(array_filter(array_map(fn($x) => $s($x, 120), $names), 'strlen'));
    }
    return $o;
}

/* ---------- publishing ---------- */
function cms_public_file(string $file): string { return CMS_ROOT . '/' . $file; }

function cms_page_files(): array {
    $reg = cms_registry(); $files = [];
    foreach ($reg['pages'] ?? [] as $p) if (($p['kind'] ?? '') !== 'case') $files[] = $p['file'];
    foreach ($reg['cases'] ?? [] as $slug => $c) $files[] = $c['file'];
    return array_values(array_unique($files));
}

function cms_render(string $file, array $content, bool $preview = false): string {
    if (!preg_match('/^[a-z0-9-]+\.html$/', $file)) throw new RuntimeException('Unknown page.');
    $tplFile = cms_path('templates/' . $file);
    if (!is_file($tplFile)) throw new RuntimeException('There is no template for ' . $file . '.');
    $D = cms_defaults()[$file] ?? ['t' => [], 'n' => [], 'a' => [], 'lists' => [], 'page' => []];
    return cms_bake(file_get_contents($tplFile), $file, $content, $D, cms_settings(), $preview);
}

function cms_publish(string $note = ''): array {
    $draft = cms_draft();
    $content = cms_clean_content($draft);
    $rev = (cms_live()['rev'] ?? 0) + 1;
    $written = [];
    foreach (cms_page_files() as $f) {
        cms_write_file(cms_public_file($f), cms_render($f, $content, false));
        $written[] = $f;
    }
    // runtime lists the pages read (testimonials, process, principles, industries, map)
    cms_write_file(CMS_ROOT . '/content.json', json_encode(['data' => $content['data']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $live = $content + ['rev' => $rev, 'published' => date('c'), 'by' => $_SESSION['cms_user']['username'] ?? '-'];
    cms_write('live.json', $live);
    cms_write('draft.json', $live);
    cms_snapshot('publish', $note, $live);
    cms_log('publish', $note . ' (' . count($written) . ' pages)');
    return ['rev' => $rev, 'pages' => $written];
}

function cms_snapshot(string $kind, string $note, ?array $content = null): string {
    $id = date('Ymd-His') . '-' . bin2hex(random_bytes(2));
    $snap = ['id' => $id, 'kind' => $kind, 'note' => mb_substr($note, 0, 200), 'time' => date('c'),
             'by' => $_SESSION['cms_user']['username'] ?? '-', 'content' => $content ?? cms_live(),
             'settings' => cms_settings(), 'registry' => cms_registry()];
    cms_write('history/' . $id . '.json', $snap);
    $files = glob(cms_path('history/*.json')) ?: [];
    rsort($files);
    foreach (array_slice($files, CMS_HISTORY_KEEP) as $old) @unlink($old);
    return $id;
}

function cms_history(): array {
    $out = [];
    $files = glob(cms_path('history/*.json')) ?: [];
    rsort($files);
    foreach ($files as $f) {
        $s = json_decode(file_get_contents($f), true);
        if ($s) $out[] = ['id' => $s['id'], 'kind' => $s['kind'], 'note' => $s['note'], 'time' => $s['time'], 'by' => $s['by'],
                          'cases' => count($s['registry']['cases'] ?? [])];
    }
    return $out;
}

/** Restoring loads a snapshot into the draft and restores settings and case list; publishing makes it live */
function cms_restore(string $id): void {
    if (!preg_match('/^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/', $id)) throw new RuntimeException('Unknown version.');
    $s = cms_read('history/' . $id . '.json', null);
    if (!$s) throw new RuntimeException('That version is no longer available.');
    cms_snapshot('before-restore', 'Automatic backup before restoring ' . $id, cms_draft());
    $draft = $s['content']; $draft['rev'] = (cms_draft()['rev'] ?? 0) + 1;
    cms_write('draft.json', $draft);
    if (isset($s['settings'])) cms_write('settings.json', $s['settings']);
    if (isset($s['registry'])) {
        foreach ($s['registry']['cases'] ?? [] as $slug => $c) {
            if (!is_file(cms_path('templates/' . $c['file'])) && is_file(cms_path('templates/_deleted/' . $c['file'])))
                rename(cms_path('templates/_deleted/' . $c['file']), cms_path('templates/' . $c['file']));
        }
        cms_write('registry.json', $s['registry']);
    }
    cms_log('restore', $id);
}

/* ---------- case studies ---------- */
function cms_slug(string $s): string {
    $s = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', $s), '-'));
    return substr($s, 0, 40);
}

/** Copy a case study: new page from the source template with its own keys, plus a card and a menu item */
function cms_duplicate_case(string $source, string $slug, string $title): array {
    $reg = cms_registry();
    if (!isset($reg['cases'][$source])) throw new RuntimeException('Pick a case study to copy.');
    $slug = cms_slug($slug);
    if ($slug === '' || isset($reg['cases'][$slug]) || is_file(cms_path('templates/case-' . $slug . '.html')) || is_file(cms_public_file('case-' . $slug . '.html')))
        throw new RuntimeException('That web address is already used. Choose another.');
    $srcFile = $reg['cases'][$source]['file']; $newFile = 'case-' . $slug . '.html';
    $srcScope = preg_replace('/^case-|\.html$/', '', $srcFile);
    $tpl = file_get_contents(cms_path('templates/' . $srcFile));
    // page-scoped keys move to the new page; shared keys (header, footer, menus) stay shared
    $tpl = preg_replace('/(?<=[:"~ ])' . preg_quote($srcScope, '/') . '\.(?=(?:tx|tn|img|lnk|L|card)[0-9a-f])/', $slug . '.', $tpl);
    $tpl = preg_replace('/(<!--\/?cms:(?:list|item) )' . preg_quote($srcScope, '/') . '\./', '$1' . $slug . '.', $tpl);
    cms_write_file(cms_path('templates/' . $newFile), $tpl);

    $defaults = cms_defaults();
    $remap = function ($arr) use ($srcScope, $slug) {
        $o = [];
        foreach ($arr as $k => $v) $o[preg_replace('/^' . preg_quote($srcScope, '/') . '\./', $slug . '.', $k)] = $v;
        return $o;
    };
    $D = $defaults[$srcFile];
    $nd = ['t' => $remap($D['t']), 'n' => $remap($D['n']), 'a' => $remap($D['a']), 'lists' => [], 'page' => $D['page']];
    foreach ($D['lists'] as $L => $st) {
        $nl = preg_replace('/^' . preg_quote($srcScope, '/') . '\./', $slug . '.', $L);
        $fix = fn($ids) => array_map(fn($i) => preg_replace('/^' . preg_quote($srcScope, '/') . '\./', $slug . '.', $i), $ids);
        $nd['lists'][$nl] = ['order' => $fix($st['order']), 'more' => $fix($st['more'] ?? [])];
    }
    $nd['page']['title'] = $title;
    $defaults[$newFile] = $nd;
    cms_write('defaults.json', $defaults);

    // copy the draft edits made on the source page
    $draft = cms_draft();
    foreach (['t', 'n', 'a', 'lists'] as $part) {
        foreach (($draft[$part] ?? []) as $k => $v) {
            if (strpos($k, $srcScope . '.') === 0 || preg_match('/^c[0-9a-f]+~' . preg_quote($srcScope, '/') . '\./', $k)) {
                $nk = str_replace($srcScope . '.', $slug . '.', $k);
                if ($part === 'lists') $v = array_map(fn($ids) => array_map(fn($i) => str_replace($srcScope . '.', $slug . '.', $i), $ids), $v);
                $draft[$part][$nk] = $v;
            }
        }
    }
    $draft['pages'][$newFile]['title'] = $title;

    // home card and work-menu item: copies of the source's, pointing to the new page
    $card = cms_clone_list_item($draft, $defaults, $reg['workList'], $reg['cases'][$source]['card'], $srcFile, $newFile, $title);
    $nav = isset($reg['cases'][$source]['nav']) ? cms_clone_list_item($draft, $defaults, $reg['navList'], $reg['cases'][$source]['nav'], $srcFile, $newFile, $title) : null;
    $draft['rev'] = ($draft['rev'] ?? 0) + 1;
    cms_write('draft.json', $draft);

    $reg['cases'][$slug] = ['file' => $newFile, 'card' => $card] + ($nav ? ['nav' => $nav] : []);
    $reg['order'][] = $slug;
    cms_write('registry.json', $reg);
    cms_log('case-duplicate', "$source -> $slug");
    return ['slug' => $slug, 'file' => $newFile];
}

/** Adds a copy of a list item after the original and re-points its links from one page to another */
function cms_clone_list_item(array &$draft, array $defaults, string $list, string $itemId, string $fromFile, string $toFile, string $title): string {
    $cid = 'c' . bin2hex(random_bytes(3));
    $newId = $cid . '~' . $itemId;
    $home = $defaults['home.html'];
    $st = cms_list_state($list, $draft, $home);
    $pos = array_search($itemId, $st['order'], true);
    array_splice($st['order'], $pos === false ? count($st['order']) : $pos + 1, 0, [$newId]);
    $draft['lists'][$list] = $st;
    // find the item's markup in the home template to re-point its links and set its title
    $tpl = file_get_contents(cms_path('templates/home.html'));
    if (preg_match('/<!--cms:item ' . preg_quote($itemId, '/') . '-->(.*?)<!--\/cms:item ' . preg_quote($itemId, '/') . '-->/s', $tpl, $m)) {
        preg_match_all('/data-cms-a="([^"]+)"/', $m[1], $am);
        foreach ($am[1] as $ak) {
            $href = cms_lookup($draft['a'] ?? [], $ak)['href'] ?? ($home['a'][$ak]['href'] ?? null);
            if ($href !== null && strpos($href, $fromFile) !== false) $draft['a'][$cid . '~' . $ak]['href'] = str_replace($fromFile, $toFile, $href);
        }
        if (preg_match('/<a class="case-link"[^>]*data-cms-tn="([^" ]+)/', $m[1], $tm)) $draft['n'][$cid . '~' . $tm[1]] = $title;
        elseif (preg_match('/<a [^>]*data-cms-k="([^"]+)"/', $m[1], $tm)) {
            // menu item: keep its description line, change the name
            $src = cms_lookup($draft['t'] ?? [], $tm[1]) ?? ($home['t'][$tm[1]] ?? '');
            $t = htmlspecialchars($title, ENT_NOQUOTES, 'UTF-8');
            $draft['t'][$cid . '~' . $tm[1]] = preg_match('/<span class="sm-t">.*?<\/span>/s', $src)
                ? preg_replace('/<span class="sm-t">.*?<\/span>/s', '<span class="sm-t">' . $t . '</span>', $src, 1)
                : $t;
        }
    }
    return $newId;
}

function cms_delete_case(string $slug): void {
    $reg = cms_registry();
    if (!isset($reg['cases'][$slug])) throw new RuntimeException('That case study no longer exists.');
    $c = $reg['cases'][$slug];
    cms_snapshot('before-delete', 'Automatic backup before deleting ' . $slug, cms_draft());
    $draft = cms_draft(); $home = cms_defaults()['home.html'];
    foreach ([['workList', 'card'], ['navList', 'nav']] as [$lk, $ik]) {
        if (empty($c[$ik])) continue;
        $L = $reg[$lk]; $st = cms_list_state($L, $draft, $home);
        foreach (['order', 'hidden', 'more'] as $part) $st[$part] = array_values(array_diff($st[$part] ?? [], [$c[$ik]]));
        $draft['lists'][$L] = $st;
    }
    $draft['rev'] = ($draft['rev'] ?? 0) + 1;
    cms_write('draft.json', $draft);
    $tpl = cms_path('templates/' . $c['file']);
    if (is_file($tpl)) { @mkdir(cms_path('templates/_deleted'), 0755, true); rename($tpl, cms_path('templates/_deleted/' . $c['file'])); }
    if (is_file(cms_public_file($c['file']))) @unlink(cms_public_file($c['file']));
    unset($reg['cases'][$slug]);
    $reg['order'] = array_values(array_diff($reg['order'] ?? [], [$slug]));
    cms_write('registry.json', $reg);
    cms_log('case-delete', $slug);
}

/* ---------- media ---------- */
function cms_media_list(): array {
    $out = [];
    foreach (['uploads', 'music', 'cs', 'cs2', 'cs3', 'cs4', 'cs5', 'cs6', 'cs7', 'cs7/img', 'cs6/img', ''] as $dir) {
        $abs = CMS_ROOT . ($dir ? '/' . $dir : '');
        if (!is_dir($abs)) continue;
        foreach (scandir($abs) as $f) {
            $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
            if (!isset(CMS_MEDIA_TYPES[$ext]) || $ext === 'woff2' || !is_file("$abs/$f")) continue;
            $path = ($dir ? $dir . '/' : '') . $f;
            $info = ['path' => $path, 'name' => $f, 'size' => filesize("$abs/$f"), 'type' => $ext, 'modified' => date('c', filemtime("$abs/$f")),
                     'deletable' => $dir === 'uploads'];
            if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'], true)) {
                $d = @getimagesize("$abs/$f"); if ($d) { $info['width'] = $d[0]; $info['height'] = $d[1]; }
            }
            $out[] = $info;
        }
    }
    usort($out, fn($a, $b) => strcmp($b['modified'], $a['modified']));
    return $out;
}

function cms_media_upload(array $file): array {
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) throw new RuntimeException('The upload did not finish. Try again.');
    if ($file['size'] > CMS_MAX_UPLOAD) throw new RuntimeException('Files can be up to 20 MB.');
    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    if (!isset(CMS_MEDIA_TYPES[$ext]) || $ext === 'woff2') throw new RuntimeException('Upload JPG, PNG, WebP, GIF, AVIF, MP3 or PDF files.');
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    if (!in_array($mime, CMS_MEDIA_TYPES[$ext], true)) throw new RuntimeException('That file is not really a .' . $ext . ' file.');
    if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif'], true) && !@getimagesize($file['tmp_name'])) throw new RuntimeException('That image could not be read.');
    $base = cms_slug(pathinfo($file['name'], PATHINFO_FILENAME)) ?: 'file';
    if (!is_dir(CMS_UPLOADS)) mkdir(CMS_UPLOADS, 0755, true);
    $name = $base . '.' . $ext; $i = 2;
    while (file_exists(CMS_UPLOADS . '/' . $name)) $name = $base . '-' . $i++ . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], CMS_UPLOADS . '/' . $name)) throw new RuntimeException('The file could not be saved. Check that /uploads is writable.');
    @chmod(CMS_UPLOADS . '/' . $name, 0644);
    cms_log('upload', $name);
    return ['path' => 'uploads/' . $name];
}

function cms_media_delete(string $path): void {
    if (!preg_match('#^uploads/[a-z0-9-]+\.[a-z0-9]+$#', $path) || !is_file(CMS_ROOT . '/' . $path)) throw new RuntimeException('Only uploaded files can be deleted.');
    unlink(CMS_ROOT . '/' . $path);
    cms_log('media-delete', $path);
}
