var global = (function() {
    return this
})();
if (!global && typeof GameGlobal !== 'undefined') global = GameGlobal;
var pluginInfoMap = {};;
global.requirePlugin = global.requirePlugin || function(path) {
    var position = path.indexOf('/');
    var alias = '';
    var pagePath = '';
    if (position !== -1) {
        alias = path.substr(0, position);
        pagePath = path.substr(position + 1, path.length);
    } else {
        alias = path;
    }
    if (pluginInfoMap.hasOwnProperty(alias)) {
        var realPath = '';
        if (pagePath.length === 0) {
            realPath = '__plugin__/' + pluginInfoMap[alias].appid;
            return require(realPath);
        } else {
            realPath = '__plugin__/' + pluginInfoMap[alias].appid + '/' + pagePath;
            return require(realPath);
        }
    } else {
        console.error('not found alias: ', alias);
        throw new Error('Plugin ' + alias + ' is not defined.')
    }
};
define("resources/anim/game.js", function(require, module, exports) {
    console.log('subpackage resources/anim loaded');
});
require("resources/anim/game.js");