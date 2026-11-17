<?php
/* JSON API for /admin. Every change needs a logged-in user and the session's CSRF token. */
require __DIR__ . '/lib/core.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');
cms_session();

function out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(string $msg, int $code = 400): void { out(['error' => $msg], $code); }
function body(): array {
    $d = json_decode(file_get_contents('php://input') ?: '[]', true);
    return is_array($d) ? $d : [];
}
function need_user(?string $role = null): array {
    $u = cms_current_user();
    if (!$u) fail('Your session has ended. Log in again.', 401);
    if ($role === 'admin' && $u['role'] !== 'admin') fail('Only an administrator can do that.', 403);
    return $u;
}
function need_csrf(): void {
    $t = $_SERVER['HTTP_X_CSRF'] ?? ($_POST['csrf'] ?? '');
    if (!is_string($t) || !hash_equals($_SESSION['cms_csrf'] ?? '', $t)) fail('This page is out of date. Reload and try again.', 419);
}

$action = $_GET['a'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST' && !in_array($action, ['login', 'setup'], true)) need_csrf();
if ($method === 'POST' && in_array($action, ['login', 'setup'], true)) {
    // login and setup come from our own page: check the origin as well as the token
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && parse_url($origin, PHP_URL_HOST) !== parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) fail('Blocked request.', 403);
    need_csrf();
}

try {
    switch ($action) {

    case 'state':
        out(['setup' => cms_needs_setup(), 'user' => cms_current_user(), 'csrf' => $_SESSION['cms_csrf'], 'writable' => is_writable(CMS_DATA) && is_writable(CMS_ROOT)]);

    case 'setup':
        if (!cms_needs_setup()) fail('Setup is already done. Log in instead.', 403);
        $b = body(); $user = trim($b['username'] ?? ''); $name = trim($b['name'] ?? '');
        // one-time code from cms-data/SETUP-CODE.txt, so only the site owner can create the first account
        $codeFile = cms_path('SETUP-CODE.txt');
        $code = is_file($codeFile) ? trim((string)file_get_contents($codeFile)) : '';
        if ($code === '') fail('Setup is locked. Add a file cms-data/SETUP-CODE.txt containing a code of your choice, then enter that code here.', 403);
        if (!hash_equals($code, trim((string)($b['code'] ?? '')))) { cms_note_failure('__setup'); fail(cms_locked('__setup') ? 'Too many attempts. Try again in 15 minutes.' : 'That setup code is not right. It is in cms-data/SETUP-CODE.txt in the files you uploaded.', 403); }
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $user)) fail('Choose a username of 3 to 40 letters, numbers, dots or dashes.');
        if ($err = cms_password_ok($b['password'] ?? '')) fail($err);
        cms_write('users.json', [['id' => bin2hex(random_bytes(6)), 'username' => $user, 'name' => $name ?: $user, 'role' => 'admin',
                                   'hash' => password_hash($b['password'], PASSWORD_DEFAULT), 'created' => date('c')]]);
        if (!is_file(cms_path('live.json'))) cms_write('live.json', ['rev' => 0]);
        @unlink($codeFile);
        cms_log('setup', $user);
        $r = cms_login($user, $b['password']);
        out($r + ['csrf' => $_SESSION['cms_csrf']]);

    case 'login':
        $b = body();
        $r = cms_login(trim($b['username'] ?? ''), (string)($b['password'] ?? ''));
        if (!$r['ok']) out($r, 401);
        out($r + ['csrf' => $_SESSION['cms_csrf'], 'user' => cms_current_user()]);

    case 'logout':
        cms_log('logout'); $_SESSION = []; session_regenerate_id(true); out(['ok' => true]);

    case 'bootstrap':
        $u = need_user();
        $s = cms_settings(); unset($s['caseHash']);
        $s['casePasswordSet'] = !empty(cms_settings()['caseHash']);
        $draft = cms_draft(); $live = cms_live();
        out(['user' => $u, 'registry' => cms_registry(), 'settings' => $s, 'draft' => $draft, 'liveRev' => $live['rev'] ?? 0,
             'published' => $live['published'] ?? null, 'changed' => json_encode(cms_clean_content($draft)) !== json_encode(cms_clean_content($live)),
             'pageDefaults' => array_map(fn($d) => $d['page'], cms_defaults())]);

    case 'defaults':
        need_user();
        $f = $_GET['page'] ?? '';
        $D = cms_defaults()[$f] ?? null;
        if (!$D) fail('Unknown page.', 404);
        out(['lists' => $D['lists'], 'page' => $D['page']]);

    case 'preview':
        need_user();
        $file = $_GET['page'] ?? 'home.html';
        $html = cms_render($file, cms_clean_content(cms_draft()), true);
        $hash = preg_match('/^[0-9a-f]{64}$/', cms_settings()['caseHash'] ?? '') ? cms_settings()['caseHash'] : CMS_DEFAULT_HASH;
        $data = cms_clean_content(cms_draft())['data'];
        $boot = '<base href="../"><script>window.__cmsPreview=true;window.__cmsPreviewData=' . json_encode((object)$data, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_UNICODE) . ';try{sessionStorage.setItem("sp-case-ok",' . json_encode($hash) . ')}catch(e){}'
              . 'HTMLMediaElement.prototype.play=function(){return Promise.resolve()};</script>';
        $html = preg_replace('/<head>/i', '<head>' . $boot, $html, 1);
        $v = @filemtime(__DIR__ . '/assets/editor.js');
        $html = preg_replace('/<\/body>/i', '<link rel="stylesheet" href="admin/assets/editor.css?v=' . $v . '"><script src="admin/assets/editor.js?v=' . $v . '"></script></body>', $html, 1);
        header('Content-Type: text/html; charset=utf-8');
        header('X-Frame-Options: SAMEORIGIN');
        echo $html; exit;

    case 'draft':
        need_user();
        $b = body(); $cur = cms_draft();
        if (isset($b['rev']) && (int)$b['rev'] !== (int)($cur['rev'] ?? 0)) out(['error' => 'Someone else saved changes. Reload to see them.', 'conflict' => true, 'rev' => $cur['rev'] ?? 0], 409);
        $c = cms_clean_content($b['content'] ?? []);
        $c['rev'] = ($cur['rev'] ?? 0) + 1; $c['saved'] = date('c'); $c['by'] = $_SESSION['cms_user']['username'];
        cms_write('draft.json', $c);
        out(['rev' => $c['rev'], 'saved' => $c['saved']]);

    case 'discard':
        need_user();
        $live = cms_live(); $live['rev'] = (cms_draft()['rev'] ?? 0) + 1;
        cms_write('draft.json', $live); cms_log('discard');
        out(['ok' => true, 'rev' => $live['rev']]);

    case 'publish':
        need_user();
        out(cms_publish(trim((string)(body()['note'] ?? ''))));

    case 'history':
        need_user(); out(['items' => cms_history()]);

    case 'restore':
        need_user('admin'); cms_restore((string)(body()['id'] ?? '')); out(['ok' => true]);

    case 'activity':
        need_user('admin');
        $lines = is_file(cms_path('activity.log')) ? array_slice(file(cms_path('activity.log'), FILE_IGNORE_NEW_LINES), -300) : [];
        out(['items' => array_reverse(array_values(array_filter(array_map(fn($l) => json_decode($l, true), $lines))))]);

    case 'media':
        need_user(); out(['items' => cms_media_list()]);

    case 'upload':
        need_user();
        $res = [];
        $files = $_FILES['files'] ?? null;
        if (!$files) fail('Choose a file to upload.');
        $n = is_array($files['name']) ? count($files['name']) : 1;
        for ($i = 0; $i < $n; $i++) {
            $f = is_array($files['name']) ? ['name' => $files['name'][$i], 'type' => $files['type'][$i], 'tmp_name' => $files['tmp_name'][$i], 'error' => $files['error'][$i], 'size' => $files['size'][$i]] : $files;
            try { $res[] = cms_media_upload($f); } catch (RuntimeException $e) { $res[] = ['error' => $f['name'] . ': ' . $e->getMessage()]; }
        }
        out(['items' => $res]);

    case 'media-delete':
        need_user(); cms_media_delete((string)(body()['path'] ?? '')); out(['ok' => true]);

    case 'settings':
        need_user('admin');
        $b = body(); $s = cms_settings();
        $in = $b['settings'] ?? [];
        $s['siteName'] = mb_substr(trim(strip_tags((string)($in['siteName'] ?? ($s['siteName'] ?? 'Sanjay Pal UX')))), 0, 80);
        $s['colors'] = [];
        foreach (($in['colors'] ?? []) as $k => $v) if (preg_match('/^--[a-z0-9-]{1,30}$/', $k) && preg_match('/^#[0-9a-fA-F]{6}$/', $v)) $s['colors'][$k] = $v;
        $s['fonts'] = [];
        foreach (['display', 'body'] as $r) { $f = trim((string)($in['fonts'][$r] ?? '')); if ($f === '' || preg_match('/^[A-Za-z0-9 ]{2,60}$/', $f)) $s['fonts'][$r] = $f; }
        $s['ogImage'] = cms_safe_url((string)($in['ogImage'] ?? '')) ? mb_substr((string)($in['ogImage'] ?? ''), 0, 300) : '';
        $s['tracks'] = [];
        foreach (($in['tracks'] ?? []) as $t) if (!empty($t['src']) && preg_match('#^[a-z0-9/_.-]+\.mp3$#i', $t['src']))
            $s['tracks'][] = ['src' => $t['src'], 'title' => mb_substr(strip_tags((string)($t['title'] ?? '')), 0, 80), 'off' => !empty($t['off'])];
        if (!empty($b['casePassword'])) {
            if (strlen($b['casePassword']) < 8) fail('Make the case-study password at least 8 characters.');
            $s['caseHash'] = hash('sha256', trim($b['casePassword']));
            cms_log('case-password');
        }
        cms_write('settings.json', $s); cms_log('settings');
        out(['ok' => true, 'note' => 'Saved. Publish to apply them to the live site.']);

    case 'case-duplicate':
        need_user();
        $b = body();
        $title = trim(strip_tags((string)($b['title'] ?? '')));
        if ($title === '') fail('Give the case study a name.');
        out(cms_duplicate_case((string)($b['source'] ?? ''), (string)($b['slug'] ?? $title), $title));

    case 'case-delete':
        need_user('admin'); cms_delete_case((string)(body()['slug'] ?? '')); out(['ok' => true]);

    case 'users':
        need_user('admin'); out(['items' => array_map('cms_public_user', cms_users())]);

    case 'user-save':
        $me = need_user('admin'); $b = body(); $users = cms_users();
        $id = $b['id'] ?? null; $role = in_array($b['role'] ?? '', ['admin', 'editor'], true) ? $b['role'] : 'editor';
        $username = trim($b['username'] ?? '');
        if (!preg_match('/^[A-Za-z0-9._-]{3,40}$/', $username)) fail('Choose a username of 3 to 40 letters, numbers, dots or dashes.');
        foreach ($users as $u) if (strcasecmp($u['username'], $username) === 0 && $u['id'] !== $id) fail('That username is taken.');
        if ($id) {
            $found = false;
            foreach ($users as &$u) if ($u['id'] === $id) {
                $found = true;
                if ($u['id'] === $me['id'] && $role !== 'admin') fail('You cannot remove your own administrator role.');
                $u['username'] = $username; $u['name'] = trim($b['name'] ?? '') ?: $username; $u['role'] = $role;
                if (!empty($b['password'])) { if ($e = cms_password_ok($b['password'])) fail($e); $u['hash'] = password_hash($b['password'], PASSWORD_DEFAULT); }
            }
            unset($u);
            if (!$found) fail('That user no longer exists.');
        } else {
            if ($e = cms_password_ok($b['password'] ?? '')) fail($e);
            $users[] = ['id' => bin2hex(random_bytes(6)), 'username' => $username, 'name' => trim($b['name'] ?? '') ?: $username, 'role' => $role,
                        'hash' => password_hash($b['password'], PASSWORD_DEFAULT), 'created' => date('c')];
        }
        cms_write('users.json', $users); cms_log('user-save', $username);
        out(['ok' => true]);

    case 'user-delete':
        $me = need_user('admin'); $id = (string)(body()['id'] ?? '');
        if ($id === $me['id']) fail('You cannot delete your own account.');
        $users = array_values(array_filter(cms_users(), fn($u) => $u['id'] !== $id));
        if (!array_filter($users, fn($u) => $u['role'] === 'admin')) fail('Keep at least one administrator.');
        cms_write('users.json', $users); cms_log('user-delete', $id);
        out(['ok' => true]);

    case 'password':
        $me = need_user(); $b = body(); $users = cms_users();
        foreach ($users as &$u) if ($u['id'] === $me['id']) {
            if (!password_verify((string)($b['current'] ?? ''), $u['hash'])) fail('Your current password is not right.');
            if ($e = cms_password_ok($b['new'] ?? '')) fail($e);
            $u['hash'] = password_hash($b['new'], PASSWORD_DEFAULT);
        }
        unset($u);
        cms_write('users.json', $users); cms_log('password');
        out(['ok' => true]);

    default:
        fail('Unknown request.', 404);
    }
} catch (RuntimeException $e) {
    fail($e->getMessage());
} catch (Throwable $e) {
    error_log('CMS: ' . $e);
    fail('Something went wrong on the server. Nothing was changed.', 500);
}
