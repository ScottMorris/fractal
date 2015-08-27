var promise     = require("bluebird");
var _           = require('lodash');
var minimatch   = require('minimatch');
var Handlebars  = require('handlebars');
var merge       = require('deepmerge');
var swag        = require('swag');
var cheerio     = require('cheerio');

var Directory   = require('./fs/directory');
var File        = require('./fs/file');
var DataFetcher = require('./data');
var config      = require('./config');
var output      = require('./output');
var fractal     = require('../fractal');

module.exports = Component;

function Component(config){
    this.id             = config.id;
    this.path           = config.path;
    this.title          = config.title;
    this.hidden         = config.hidden;
    this.order          = config.order || 0;
    this.data           = config.data || {};
    this.type           = 'component';
    this.files          = config.files || {};
    this.layoutComponent = null;
};

Component.fromFile = function(file){
    return new Component({
        id:     file.getId(),
        title:  file.getTitle(),
        path:   file.fauxInfo.urlStylePath,
        order:  file.order,
        hidden: file.isHidden(),
        data:   file.data,
        files: {
            markup: file
        }
    });
};

Component.fromDirectory = function(dir){
    var main            = findRelated(dir, dir.children, 'markup');
    var data            = merge(main.data, DataFetcher.fetchFromFile(findRelated(main, dir.children, 'data')) || {});    
    return new Component({
        id:     data.id || main.getId(),
        title:  data.title || main.getTitle(),
        path:   dir.fauxInfo.urlStylePath,
        order:  dir.order,
        hidden: data.hidden || main.isHidden(),
        data:   data,
        files: {
            markup: main,
            readme: findRelated(main, dir.children, 'readme'),
            styles: findAllRelated(main, dir.children, 'styles')
        }
    });
};

Component.prototype.render = function(variant, withoutLayout){
    return output.render(this, variant, withoutLayout);
};

Component.prototype.getData = function(){
    return merge(this.data, {
        id: this.id,
        title: this.title,
        hidden: this.hidden
    });
};

Component.prototype.getNotes = function(){
    var readmeFile = _.get(this, 'files.readme');
    if (readmeFile) {
        console.log(cheerio);
        var $ = cheerio.load(readmeFile.content.toString());
        $('h1').remove();
        return $.html();
    }
    return null;
};

Component.prototype.getStyles = function(){
    var styleFiles = _.get(this, 'files.styles');
    if (styleFiles) {
        if (styleFiles.length === 1) {
            var content = styleFiles[0].content.toString();
        } else {
            var content = styleFiles.map(function(file){
                return "/* " + file.fauxInfo.base + " *\/\n\n" + file.content.toString() + "\n\n";
            }).join("\n")
        }
        return content;
    }
    return null;
};

Component.prototype.getTemplateContext = function(variant){
    var variants = this.getVariants();
    if (variant) {
        var data = _.find(variants, 'name', variant) || variants[0];
    } else {
        data = variants[0];
    }
    return data.context || {};
};

Component.prototype.getVariants = function(){
    var base = _.clone(this.getData());
    var variants = this.data.variants || {};
    delete base.variants;
    base.name = 'base';
    base.title = 'Base';
    variants = _.map(variants, function(variant, key){
        variant.name = key;
        variant.title = variant.title || titleize(variant.name);
        variant.id = base.id + '--' + key;
        return merge(base, variant);
    });
    if (!_.find(variants, 'name', 'base')) {
        variants.unshift(base);    
    }
    return variants;
};

Component.prototype.getTemplateMarkup = function(){
    return promise.resolve(this.files.markup.content.toString());
};

Component.prototype.getLayoutMarkup = function(){
    return this.getLayout().then(function(layout){
        if (!layout) {
            return '{{{content}}}';
        }
        if (_.isString(layout)) {
            return layout;
        }
        return layout.files.markup.content.toString();
    });
};

Component.prototype.isComponent = function(){
    return true;
};

Component.prototype.getLayout = function(){
    var self = this;
    if (!this.layoutComponent) {
        this.layoutComponent = fractal.getSources().then(function(sources){
            var layout = null;
            var checkLayout = self.data.layout || config.get('source.components.layout');
            if (checkLayout && checkLayout !== self.id && checkLayout !== self.path ) {
                layout = sources.components.tryFindComponent(checkLayout);
            }
            return layout;
        });
    }
    return this.layoutComponent;
};

function getFileMatcher(name, match){
    return match.replace('__name__', name);
}

function findRelated(file, files, matches, multiple) {
    var name = _.get(file, 'name');
    var results = _.filter(files, function(f){
        return minimatch(f.fauxInfo.base, getFileMatcher(name, config.get('source.components.matches.' + matches)));
    });
    if (results.length) {
        if (multiple) {
            return results;
        } else {
            return _.first(results);
        }
    }
    return null;
}

function findAllRelated(file, files, matches) {
    return findRelated(file, files, matches, true);
}

function titleize(str){
    return swag.helpers['titleize'](str);
}