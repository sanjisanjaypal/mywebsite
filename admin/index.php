<?php
require __DIR__ . '/lib/core.php';
cms_session();
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
header('Cache-Control: no-store');
$v = function ($f) { return @filemtime(__DIR__ . '/assets/' . $f) ?: 1; };
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Admin · Sanjay Pal</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23062216'/%3E%3Ctext x='16' y='21' text-anchor='middle' font-family='Arial' font-weight='700' font-size='14' fill='%23DDF3AA'%3ESP%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="assets/app.css?v=<?= $v('app.css') ?>">
</head>
<body>
<div id="app" aria-live="polite"><p class="boot">Loading the admin…</p></div>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
<script src="assets/app.js?v=<?= $v('app.js') ?>"></script>
</body>
</html>
