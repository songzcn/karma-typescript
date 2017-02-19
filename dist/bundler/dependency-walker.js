"use strict";
var glob = require("glob");
var path = require("path");
var ts = require("typescript");
var RequiredModule = require("./required-module");
var DependencyWalker = (function () {
    function DependencyWalker() {
        this.requireRegexp = /\brequire\b/;
        this.walk = require("acorn/dist/walk");
    }
    DependencyWalker.prototype.initialize = function (logger) {
        this.log = logger.create("dependency-walker.karma-typescript");
    };
    DependencyWalker.prototype.hasRequire = function (s) {
        return this.requireRegexp.test(s);
    };
    DependencyWalker.prototype.collectRequiredTsModules = function (queue) {
        var _this = this;
        var requiredModuleCount = 0;
        queue.forEach(function (queued) {
            queued.module.requiredModules = _this.findUnresolvedTsRequires(queued.emitOutput.sourceFile);
            if (queued.emitOutput.sourceFile.resolvedModules &&
                !queued.emitOutput.sourceFile.isDeclarationFile) {
                Object.keys(queued.emitOutput.sourceFile.resolvedModules).forEach(function (moduleName) {
                    var resolvedModule = queued.emitOutput.sourceFile.resolvedModules[moduleName];
                    queued.module.requiredModules.push(new RequiredModule(moduleName, resolvedModule && resolvedModule.resolvedFileName));
                });
            }
            requiredModuleCount += queued.module.requiredModules.length;
        });
        return requiredModuleCount;
    };
    DependencyWalker.prototype.collectRequiredJsModules = function (requiredModule) {
        var _this = this;
        var moduleNames = [];
        var expressions = [];
        var isRequire = function (node) {
            return node.type === "CallExpression" &&
                node.callee.type === "Identifier" &&
                node.callee.name === "require";
        };
        var visit = function (node, state, c) {
            if (!_this.hasRequire(requiredModule.source.slice(node.start, node.end))) {
                return;
            }
            _this.walk.base[node.type](node, state, c);
            if (isRequire(node) && node.arguments.length > 0) {
                if (node.arguments[0].type === "Literal") {
                    moduleNames.push(node.arguments[0].value);
                }
                else {
                    expressions.push(node.arguments[0]);
                }
            }
        };
        this.walk.recursive(requiredModule.ast, null, {
            Expression: visit,
            Statement: visit
        });
        this.addDynamicDependencies(expressions, moduleNames, requiredModule);
        return moduleNames;
    };
    DependencyWalker.prototype.findUnresolvedTsRequires = function (sourceFile) {
        var requiredModules = [];
        if (ts.isDeclarationFile(sourceFile)) {
            return requiredModules;
        }
        var visitNode = function (node) {
            if (node.kind === ts.SyntaxKind.CallExpression) {
                var ce = node;
                var expression = ce.expression ?
                    ce.expression :
                    undefined;
                var argument = ce.arguments && ce.arguments.length ?
                    ce.arguments[0] :
                    undefined;
                if (expression && expression.text === "require" &&
                    argument && typeof argument.text === "string") {
                    requiredModules.push(new RequiredModule(argument.text));
                }
            }
            ts.forEachChild(node, visitNode);
        };
        visitNode(sourceFile);
        return requiredModules;
    };
    DependencyWalker.prototype.addDynamicDependencies = function (expressions, moduleNames, requiredModule) {
        var _this = this;
        expressions.forEach(function (expression) {
            var dynamicModuleName = _this.parseDynamicRequire(expression);
            var directory = path.dirname(requiredModule.filename);
            var pattern;
            var files;
            if (dynamicModuleName && dynamicModuleName !== "*") {
                if (new RequiredModule(dynamicModuleName).isNpmModule()) {
                    moduleNames.push(dynamicModuleName);
                }
                else {
                    pattern = path.join(directory, dynamicModuleName);
                    files = glob.sync(pattern);
                    files.forEach(function (filename) {
                        _this.log.debug("Dynamic require: \nexpression: [%s]\nfilename: %s\nrequired by %s\nglob: %s", JSON.stringify(expression, undefined, 3), filename, requiredModule.filename, pattern);
                        moduleNames.push("./" + path.relative(directory, filename));
                    });
                }
            }
        });
    };
    DependencyWalker.prototype.parseDynamicRequire = function (expression) {
        var visit = function (node) {
            switch (node.type) {
                case "BinaryExpression":
                    if (node.operator === "+") {
                        return visit(node.left) + visit(node.right);
                    }
                    break;
                case "ExpressionStatement":
                    return visit(node.expression);
                case "Literal":
                    return node.value + "";
                case "Identifier":
                    return "*";
                default:
                    return "";
            }
        };
        return visit(expression);
    };
    return DependencyWalker;
}());
module.exports = DependencyWalker;
