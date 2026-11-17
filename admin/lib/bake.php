<?php
/* Builds public pages from a template plus content.
   Templates hold placeholders ({{t:KEY}}, {{n:KEY}}, {{a:KEY:field}}, {{p:field}}, {{s:name}}) and list markers
   (<!--cms:list KEY--> <!--cms:item ID-->...). Content overrides the defaults saved for each page.
   A key or item id may carry clone prefixes ("c8f3a1~home.tx1a2b3"): a duplicated item reads its own value first,
   then the value of the item it was copied from, then the original default. */

const CMS_DEFAULT_HASH = 'd1907250208e369e5ced51f1e7f37ddc152bc033c93878229454df2816578a34';

function cms_base_key(string $k): string { $p = strrpos($k, '~'); return $p === false ? $k : substr($k, $p + 1); }

/** Value lookup through clone prefixes: c2~c1~K -> c1~K -> K */
function cms_lookup(array $map, string $k) {
    while (true) {
        if (array_key_exists($k, $map)) return $map[$k];
        $p = strpos($k, '~'); if ($p === false) return null;
        $k = substr($k, $p + 1);
    }
}

function cms_prefix_segment(string $seg, string $cid): string {
    $seg = preg_replace('/\{\{([tna]):/', '{{$1:' . $cid . '~', $seg);
    $seg = preg_replace('/(data-cms-(?:k|a|list|item)=")/', '$1' . $cid . '~', $seg);
    $seg = preg_replace_callback('/data-cms-tn="([^"]*)"/', function ($m) use ($cid) {
        return 'data-cms-tn="' . implode(' ', array_map(fn($k) => $cid . '~' . $k, preg_split('/\s+/', trim($m[1])))) . '"';
    }, $seg);
    return preg_replace('/<!--(\/?)cms:(list|item) /', '<!--$1cms:$2 ' . $cid . '~', $seg);
}

/** List state: content first, then the state of the list it was cloned from (ids re-prefixed), then defaults */
function cms_list_state(string $key, array $content, array $D): array {
    $lists = $content['lists'] ?? [];
    if (isset($lists[$key])) return $lists[$key] + ['hidden' => [], 'more' => []];
    $prefix = ''; $k = $key;
    while (($p = strpos($k, '~')) !== false) {
        $prefix .= substr($k, 0, $p + 1); $k = substr($k, $p + 1);
        if (isset($lists[$k])) { $st = $lists[$k]; break; }
    }
    if (!isset($st)) $st = $D['lists'][cms_base_key($key)] ?? ['order' => []];
    $map = fn($ids) => array_map(fn($i) => strpos($i, $prefix) === 0 ? $i : $prefix . $i, $ids ?? []);
    if ($prefix === '') return $st + ['hidden' => [], 'more' => []];
    return ['order' => $map($st['order'] ?? []), 'hidden' => $map($st['hidden'] ?? []), 'more' => $map($st['more'] ?? [])];
}

function cms_split_items(string $inner): array {
    $items = []; $pos = 0;
    while (preg_match('/<!--cms:item ([^ >]+)-->/', $inner, $m, PREG_OFFSET_CAPTURE, $pos)) {
        $id = $m[1][0]; $start = $m[0][1];
        $endTag = '<!--/cms:item ' . $id . '-->';
        $end = strpos($inner, $endTag, $start);
        if ($end === false) break;
        $items[$id] = substr($inner, $start, $end + strlen($endTag) - $start);
        $pos = $end + strlen($endTag);
    }
    return $items;
}

function cms_item_segment(string $id, array $items, int $depth = 0): ?string {
    if (isset($items[$id])) return $items[$id];
    if ($depth > 8 || ($p = strpos($id, '~')) === false) return null;
    $src = cms_item_segment(substr($id, $p + 1), $items, $depth + 1);
    return $src === null ? null : cms_prefix_segment($src, substr($id, 0, $p));
}

function cms_process_lists(string $html, array $content, array $D, bool $preview): string {
    $out = ''; $pos = 0;
    while (preg_match('/<!--cms:list ([^ >]+)-->/', $html, $m, PREG_OFFSET_CAPTURE, $pos)) {
        $key = $m[1][0]; $start = $m[0][1]; $innerStart = $start + strlen($m[0][0]);
        $endTag = '<!--/cms:list ' . $key . '-->';
        $end = strpos($html, $endTag, $innerStart);
        if ($end === false) { $out .= substr($html, $pos, $innerStart - $pos); $pos = $innerStart; continue; }
        $out .= substr($html, $pos, $start - $pos);
        $items = cms_split_items(substr($html, $innerStart, $end - $innerStart));
        $st = cms_list_state($key, $content, $D);
        $order = $st['order'] ?: array_keys($items);
        $parts = [];
        foreach ($order as $id) {
            $hidden = in_array($id, $st['hidden'] ?? [], true);
            if ($hidden && !$preview) continue;
            $seg = cms_item_segment($id, $items);
            if ($seg === null) continue;
            $seg = preg_replace('/^<!--cms:item [^>]*-->|<!--\/cms:item [^>]*-->$/', '', $seg);
            $flags = '';
            if (in_array($id, $st['more'] ?? [], true)) $flags .= ' data-more';
            if ($hidden) $flags .= ' data-cms-hidden';
            if ($flags) $seg = preg_replace('/^(\s*<[a-zA-Z][a-zA-Z0-9-]*)/', '$1' . $flags, $seg, 1);
            $parts[] = cms_process_lists($seg, $content, $D, $preview);
        }
        $out .= "\n" . implode("\n", $parts) . "\n";
        $pos = $end + strlen($endTag);
    }
    return $out . substr($html, $pos);
}

function cms_attr(string $v): string { return htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

function cms_head_extra(array $settings): string {
    $css = '';
    $vars = [];
    foreach (($settings['colors'] ?? []) as $name => $val) {
        if (preg_match('/^--[a-z0-9-]+$/', $name) && preg_match('/^#[0-9a-fA-F]{3,8}$/', $val)) $vars[] = "$name:$val";
    }
    $fonts = $settings['fonts'] ?? [];
    $links = [];
    foreach (['display' => '--display', 'body' => '--body'] as $role => $var) {
        $f = trim($fonts[$role] ?? '');
        if ($f !== '' && preg_match('/^[A-Za-z0-9 ]{2,60}$/', $f)) {
            $fallback = $role === 'display' ? 'Georgia, serif' : 'Arial, sans-serif';
            $vars[] = "$var:\"$f\", $fallback";
            $links[] = 'family=' . str_replace(' ', '+', $f) . ':wght@400;500;600;700';
        }
    }
    if ($vars) $css .= '<style id="cms-theme">:root,:root[data-theme]{' . implode(';', $vars) . '}</style>';
    if ($links) $css .= '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' . implode('&amp;', $links) . '&amp;display=swap">';
    if (!empty($settings['ogImage'])) $css .= '<meta property="og:image" content="' . cms_attr($settings['ogImage']) . '">';
    return $css;
}

function cms_tracks_js(array $settings): ?string {
    $t = $settings['tracks'] ?? null;
    if (!is_array($t) || !$t) return null;
    $parts = [];
    foreach ($t as $tr) {
        if (empty($tr['src']) || !empty($tr['off'])) continue;
        $parts[] = '{src:' . json_encode($tr['src'], JSON_UNESCAPED_SLASHES) . ', title:' . json_encode($tr['title'] ?? '', JSON_UNESCAPED_UNICODE) . '}';
    }
    return $parts ? "\n    " . implode(",\n    ", $parts) . "\n  " : null;
}

/** @param array $D defaults for this page; $preview adds editor hooks and keeps data-cms-* attributes */
function cms_bake(string $tpl, string $file, array $content, array $D, array $settings, bool $preview = false): string {
    $html = cms_process_lists($tpl, $content, $D, $preview);
    $tracks = cms_tracks_js($settings);
    $html = preg_replace_callback('/\{\{([tnaps]):([^}]*)\}\}/', function ($m) use ($content, $D, $settings, $file, $tracks, $preview) {
        [$all, $type, $k] = $m;
        switch ($type) {
            case 't':
                $v = cms_lookup($content['t'] ?? [], $k);
                return $v !== null ? $v : ($D['t'][cms_base_key($k)] ?? '');
            case 'n':
                $v = cms_lookup($content['n'] ?? [], $k);
                return $v !== null ? htmlspecialchars($v, ENT_NOQUOTES, 'UTF-8') : ($D['n'][cms_base_key($k)] ?? '');
            case 'a':
                $p = strrpos($k, ':'); $key = substr($k, 0, $p); $f = substr($k, $p + 1);
                $v = cms_lookup($content['a'] ?? [], $key);
                if (is_array($v) && array_key_exists($f, $v)) return cms_attr((string)$v[$f]);
                return $D['a'][cms_base_key($key)][$f] ?? '';
            case 'p':
                $v = $content['pages'][$file][$k] ?? null;
                return $v !== null && $v !== '' ? cms_attr($v) : ($D['page'][$k] ?? '');
            case 's':
                if ($k === 'caseHash') return preg_match('/^[0-9a-f]{64}$/', $settings['caseHash'] ?? '') ? $settings['caseHash'] : CMS_DEFAULT_HASH;
                if ($k === 'headExtra') return cms_head_extra($settings);
                if ($k === 'tracks') return $tracks ?? ($D['tracks'] ?? '');
                return '';
        }
        return $all;
    }, $html);
    if (!$preview) {
        $html = preg_replace('/ data-cms-(?:k|a|tn|list|item)="[^"]*"/', '', $html);
    }
    return $html;
}
