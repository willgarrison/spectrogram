// webpack.mix.js

let mix = require('laravel-mix');

mix.js('src/scripts/app.js', 'dist/scripts')
    .sass('src/styles/main.scss', 'dist/styles')
    .copy('src/assets', 'dist/assets')
    .copy('src/static', 'dist')
    .copy('src/index.html', 'dist');
