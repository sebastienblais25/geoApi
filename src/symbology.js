/* jshint maxcomplexity: false */
'use strict';

// Functions for turning ESRI Renderers into images
// Specifically, converting ESRI "Simple" symbols into images,
// and deriving the appropriate image for a feature based on
// a renderer

// size of images to output
const maxW = 32;
const maxH = 32;

// layer symbology types
const SIMPLE = 'simple';
const UNIQUE_VALUE = 'uniqueValue';
const CLASS_BREAKS = 'classBreaks';

// use single quotes so they will not be escaped (less space in browser)
const emptySVG = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'></svg>`;

/**
* Will add extra properties to a renderer to support images.
* New properties .imageUrl and .defaultImageUrl contains image source
* for app on each renderer item.
*
* @param {Object} renderer an ESRI renderer object in server JSON form. Param is modified in place
* @param {Object} legend object for the layer that maps legend label to data url of legend image
*/
function enhanceRenderer(renderer, legend) {

    // TODO note somewhere (user docs) that everything fails if someone publishes a legend with two identical labels

    // quick lookup object of legend names to data URLs.
    // our legend object is in ESRI format, but was generated by us and only has info for a single layer.
    // so we just grab item 0, which is the only item.
    const legendLookup = {};
    legend.layers[0].legend.forEach(legItem => {
        legendLookup[legItem.label] = `data:${legItem.contentType}${legItem.base},${legItem.imageData}`;
    });

    switch (renderer.type) {
        case SIMPLE:
            renderer.imageUrl = legendLookup[renderer.label];
            break;

        case UNIQUE_VALUE:
            if (renderer.defaultLabel) {
                renderer.defaultImageUrl = legendLookup[renderer.defaultLabel];
            }

            renderer.uniqueValueInfos.forEach(uvi => {
                uvi.imageUrl = legendLookup[uvi.label];
            });

            break;
        case CLASS_BREAKS:
            if (renderer.defaultLabel) {
                renderer.defaultImageUrl = legendLookup[renderer.defaultLabel];
            }

            renderer.classBreakInfos.forEach(cbi => {
                cbi.imageUrl = legendLookup[cbi.label];
            });

            break;
        default:

            // Renderer we dont support
            console.warn('encountered unsupported renderer type: ' + renderer.type);
    }
}

/**
* Given feature attributes, find the renderer node that would draw it
*
* @method searchRenderer
* @param {Object} attributes object of feature attribute key value pairs
* @param {Object} renderer an enhanced renderer (see function enhanceRenderer)
* @return {Object} an Object with imageUrl and symbol properties for the matched renderer item
*/
function searchRenderer(attributes, renderer) {

    let imageUrl = '';
    let symbol = {};

    switch (renderer.type) {
        case SIMPLE:
            imageUrl = renderer.imageUrl;
            symbol = renderer.symbol;

            break;

        case UNIQUE_VALUE:

            // make a key value for the graphic in question, using comma-space delimiter if multiple fields
            let graphicKey = attributes[renderer.field1];

            // all key values are stored as strings.  if the attribute is in a numeric column, we must convert it to a string to ensure the === operator still works.
            if (typeof graphicKey !== 'string') {
                graphicKey = graphicKey.toString();
            }

            if (renderer.field2) {
                graphicKey = graphicKey + ', ' + attributes[renderer.field2];
                if (renderer.field3) {
                    graphicKey = graphicKey + ', ' + attributes[renderer.field3];
                }
            }

            // search the value maps for a matching entry.  if no match found, use the default image
            const uvi = renderer.uniqueValueInfos.find(uvi => uvi.value === graphicKey);
            if (uvi) {
                imageUrl = uvi.imageUrl;
                symbol = uvi.symbol;
            } else {
                imageUrl = renderer.defaultImageUrl;
                symbol = renderer.defaultSymbol;
            }

            break;

        case CLASS_BREAKS:

            const gVal = attributes[renderer.field];
            const lower = renderer.minValue;

            imageUrl = renderer.defaultImageUrl;
            symbol = renderer.defaultSymbol;

            // check for outside range on the low end
            if (gVal < lower) { break; }

            // array of minimum values of the ranges in the renderer
            let minSplits = renderer.classBreakInfos.map(cbi => cbi.maxValue);
            minSplits.splice(0, 0, lower - 1); // put lower-1 at the start of the array and shift all other entries by 1

            // attempt to find the range our gVal belongs in
            const cbi = renderer.classBreakInfos.find((cbi, index) => gVal > minSplits[index] && gVal <= cbi.maxValue);
            if (!cbi) { break; } // outside of range on the high end
            imageUrl = cbi.imageUrl;
            symbol = cbi.symbol;

            break;

        default:

            // TODO set imageUrl to blank image?
            console.warn(`Unknown renderer type encountered - ${renderer.type}`);

    }

    return { imageUrl, symbol };

}

/**
* Given feature attributes, return the image URL for that feature/graphic object.
*
* @method getGraphicIcon
* @param {Object} attributes object of feature attribute key value pairs
* @param {Object} renderer an enhanced renderer (see function enhanceRenderer)
* @return {String} imageUrl Url to the features symbology image
*/
function getGraphicIcon(attributes, renderer) {
    const renderInfo = searchRenderer(attributes, renderer);
    return renderInfo.imageUrl;
}

/**
* Given feature attributes, return the symbol for that feature/graphic object.
*
* @method getGraphicSymbol
* @param {Object} attributes object of feature attribute key value pairs
* @param {Object} renderer an enhanced renderer (see function enhanceRenderer)
* @return {Object} an ESRI Symbol object in server format
*/
function getGraphicSymbol(attributes, renderer) {
    const renderInfo = searchRenderer(attributes, renderer);
    return renderInfo.symbol;
}

/**
* Convert an ESRI colour object to SVG rgb format.
* @private
* @param  {Array} c ESRI Colour array
* @return {String} colour in SVG format
*/
function colourToRgb(c) {
    if (c) {
        return `rgb(${c[0]},${c[1]},${c[2]})`;
    } else {
        return 'none';
    }
}

/**
* Convert an ESRI colour object to SVG opacity format.
* @private
* @param  {Array} c ESRI Colour array
* @return {String} colour's opacity in SVG format
*/
function colourToOpacity(c) {
    if (c) {
        return c[3].toString();
    } else {
        return '0';
    }
}

/**
* Generate a utility object to help construct an SVG tag.
* @private
* @param  {String} type optional. the type of svg element (e.g. circle, path).
* @return {String} colour in SVG format
*/
function newSVG(type) {
    if (typeof type === 'undefined') {
        type = '';
    }
    const mySVG = {
        props: [],
        type
    };

    // adds a property to the property collection
    mySVG.addProp = (name, value) => {
        mySVG.props.push({ name, value });
    };

    // output the svg tag as string
    mySVG.belch = () => {

        // construct tag with properties.
        return `<${mySVG.type}` + mySVG.props.reduce((prev, curr) => {
            return prev + ` ${curr.name}="${curr.value}"`;
        }, '') + ' />';

    };
    return mySVG;
}

/**
* Calculate the SVG fill for a symbol.
* @private
* @param  {Object} symbol a Simple ESRI symbol object.
* @param  {Object} svg contains info on our SVG object (see newSVG). object is modified by the function
*/
function applyFill(symbol, svg) {

    // NOTE: we cannot use ESRI simple fill with styles VERTICAL, HORIZONTAL, CROSS, DIAGONAL CROSS, FORWARD DIAGONAL, BACKWARD DIAGONAL
    // ESRI implements these using image sprites containing the pattern, referenced in SVG using xlink tags.
    // xlink is not supported in data URLs, which is what we are using.
    // http://dbushell.com/2015/01/30/use-svg-part-2/

    // possible awful fix: we draw our SVG to a canvas, then export the image as a data url there.

    // second bad option: custom case, we have pre-made filled polygon (6 of them).  We would have to add the border (yuck)

    // ok solution: add a second svg <path> with the hashes in it. just be lines. thin width, black, straight.  can adjust to size

    // ------

    // the none case will only apply to polygons. point symbols can only be empty fill via opacity
    const fill = (symbol.type === 'esriSFS' && symbol.style !== 'esriSFSSolid') ? 'none' : colourToRgb(symbol.color);

    svg.addProp('fill', fill);
    svg.addProp('fill-opacity', colourToOpacity(symbol.color));
    svg.addProp('fill-rule', 'evenodd');
}

/**
* Calculate the SVG line style for a symbol.
* @private
* @param  {Object} lineSymbol a Simple ESRI symbol object.
* @param  {Object} svg contains info on our SVG object (see newSVG). object is modified by the function
*/
function applyLine(lineSymbol, svg) {
    const stroke = lineSymbol.style === 'esriSLSNull' ? 'none' : colourToRgb(lineSymbol.color);

    svg.addProp('stroke', stroke);
    svg.addProp('stroke-opacity', colourToOpacity(lineSymbol.color));
    svg.addProp('stroke-width', lineSymbol.width.toString());
    svg.addProp('stroke-linecap', 'butt'); // huh huh
    svg.addProp('stroke-linejoin', 'miter');
    svg.addProp('stroke-miterlimit', '4');

    const dashMap = {
        esriSLSSolid: 'none',
        esriSLSDash: '5.333,4',
        esriSLSDashDot: '5.333,4,1.333,4',
        esriSLSLongDashDotDot: '10.666,4,1.333,4,1.333,4',
        esriSLSDot: '1.333,4',
        esriSLSLongDash: '10.666,4',
        esriSLSLongDashDot: '10.666,4,1.333,4',
        esriSLSShortDash: '5.333,1.333',
        esriSLSShortDashDot: '5.333,1.333,1.333,1.333',
        esriSLSShortDashDotDot: '5.333,1.333,1.333,1.333,1.333,1.333',
        esriSLSShortDot: '1.333,1.333',
        esriSLSNull: 'none'
    };

    svg.addProp('stroke-dasharray', dashMap[lineSymbol.style]);

}

/**
* Calculate the SVG rotation for a symbol.
* @private
* @param  {Object} symbol a Simple ESRI symbol object.
* @param  {Object} svg contains info on our SVG object (see newSVG). object is modified by the function
*/
function applyRotation(symbol, svg) {

    // https://sarasoueidan.com/blog/svg-transformations/

    /*
    const toRad = ang => ang * (Math.PI / 180);
    const cos = Math.cos(toRad(angle));
    const sin = Math.sin(toRad(angle));
    // `matrix(${cos},${sin},${-sin},${cos},0,0)`);
    */

    const angle = symbol.angle || 0;
    svg.addProp('transform', `rotate(${angle},${maxW / 2},${maxH / 2})`);

}

/**
* Generate an SVG object for a circle marker symbol.
* @private
* @param  {Object} symbol a SimpleMarker ESRI symbol object, circle style.
* @return {Object} SVG object with circle-specific definitions
*/
function makeCircleSVG(symbol) {
    const circleSVG = newSVG('circle');

    // radius. size is diameter. cap at max image size
    circleSVG.addProp('r', Math.min(symbol.size / 2, (maxW - 4) / 2).toString());

    // center circle
    circleSVG.addProp('cx', (maxW / 2).toString());
    circleSVG.addProp('cy', (maxH / 2).toString());

    return circleSVG;
}

/**
* Calculate boundaries for drawing non-circle markers. Will cap boundaries at max image size.
* Assumes square image
* @private
* @param  {Number} size the size of the marker.
* @return {Object} object containing upper left (.upLeft), lower right (.loRite) and middle (.middle) boundaries
*/
function getGlyphCorners(size) {
    // if marker is too big, make it fit
    const trimSize = Math.min(size, maxW - 4);

    const offset = trimSize / 2;
    const middle = maxW / 2;
    return {
        upLeft: middle - offset,
        loRite: middle + offset,
        middle
    };
}

/**
* Generate an SVG object for a non-circle marker symbol.
* @private
* @param  {Object} symbol a SimpleMarker ESRI symbol object, non-circle style.
* @return {Object} SVG object with marker definitions
*/
function makeGlyphSVG(symbol) {
    const glyphSVG = newSVG('path');
    let path;

    // get the appropriate drawing path for the symbol
    if (symbol.style === 'esriSMSPath') {
        path = symbol.path;
    } else {
        // jscs:disable maximumLineLength
        const c = getGlyphCorners(symbol.size);
        switch (symbol.style) {
            case 'esriSMSCross':
                path = `M ${c.upLeft},${c.middle} ${c.loRite},${c.middle} M ${c.middle},${c.loRite} ${c.middle},${c.upLeft}`;
                break;
            case 'esriSMSDiamond':
                path = `M ${c.upLeft},${c.middle} ${c.middle},${c.loRite} ${c.loRite},${c.middle} ${c.middle},${c.upLeft} Z`;
                break;
            case 'esriSMSSquare':
                path = `M ${c.upLeft},${c.upLeft} ${c.upLeft},${c.loRite} ${c.loRite},${c.loRite} ${c.loRite},${c.upLeft} Z`;
                break;
            case 'esriSMSX':
                path = `M ${c.upLeft},${c.upLeft} ${c.loRite},${c.loRite} M ${c.upLeft},${c.loRite} ${c.loRite},${c.upLeft}`;
                break;
            case 'esriSMSTriangle':
                path = `M ${c.upLeft},${c.loRite} ${c.middle},${c.upLeft} ${c.loRite},${c.loRite} Z`;
                break;
        }

        // jscs:enable maximumLineLength
    }

    glyphSVG.addProp('d', path);
    return glyphSVG;
}

/**
* Generate an SVG object for a simple marker symbol.
* @private
* @param  {Object} symbol a SimpleMarker ESRI symbol object
* @return {Object} SVG object with marker definitions
*/
function makeMarkerSVG(symbol) {
    let svg;

    if (symbol.style === 'esriSMSCircle') {
        svg = makeCircleSVG(symbol);
    } else {
        svg = makeGlyphSVG(symbol);
    }

    applyLine(symbol.outline, svg);
    applyFill(symbol, svg);
    applyRotation(symbol, svg);

    return svg;

}

/**
* Generate an SVG object for a simple fill symbol.
* @private
* @param  {Object} symbol a SimpleFill ESRI symbol object
* @return {Object} SVG object with fill definitions
*/
function makePolySVG(symbol) {
    const polySVG = newSVG('rect');

    polySVG.addProp('x', '4');
    polySVG.addProp('y', '4');
    polySVG.addProp('width', (maxW - 8).toString());
    polySVG.addProp('height', (maxH - 8).toString());
    applyFill(symbol, polySVG);
    applyLine(symbol.outline, polySVG);

    return polySVG;
}

/**
* Generate an SVG object for a simple line symbol.
* @private
* @param  {Object} symbol a SimpleLine ESRI symbol object
* @return {Object} SVG object with line definitions
*/
function makeLineSVG(symbol) {
    const lineSVG = newSVG('path');

    // diagonal line
    lineSVG.addProp('d', `M 4,4 ${maxW - 4},${maxH - 4}`);

    applyLine(symbol, lineSVG);

    return lineSVG;
}

/**
* Generate an SVG definition for a simple symbol.
* @private
* @param  {Object} symbol a Simple ESRI symbol object
* @return {String} symbol svg as text
*/
function makeSVG(symbol) {

    const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxW}" height="${maxH}">`;
    const foot = '</svg>';

    const typeHandler = {
        esriSMS: makeMarkerSVG,
        esriSLS: makeLineSVG,
        esriCLS: makeLineSVG,
        esriSFS: makePolySVG
    };

    const svg = typeHandler[symbol.type](symbol);

    // use single quotes so they will not be escaped (less space in browser)
    return (head + svg.belch() +  foot).replace(/"/g, `'`);

}

/**
* Generate a legend item for an ESRI symbol.
* @private
* @param  {Object} symbol an ESRI symbol object in server format
* @param  {String} label label of the legend item
* @return {Object} a legend object populated with the symbol and label
*/
function symbolToLegend(symbol, label) {
    let imageData = emptySVG;
    let contentType = 'image/svg+xml';
    let base = '';

    try {
        switch (symbol.type) {
            case 'esriSMS': // simplemarkersymbol
            case 'esriSLS': // simplelinesymbol
            case 'esriSFS': // simplefillsymbol
            case 'esriCLS': // cartographiclinesymbol

                imageData = makeSVG(symbol);
                break;

            case 'esriPMS': // picturemarkersymbol
            case 'esriPFS': // picturefillsymbol

                // FIXME may be possible that there is no imageData, and it is a linked url that we can't support
                // FIXME additional for picturefill, we would want to account for the border.
                //       basically the same issue as the non-solid simplefillsymbol, in that
                //       svg data urls cannot x-link to other images

                imageData = symbol.imageData;
                contentType = symbol.contentType;
                base = ';base64';
                break;

            case 'esriTS': // textsymbol

                // not supporting at the moment
                // FIXME return a blank or default image (maybe a picture of 'Aa') to stop things from breaking
                throw new Error('no support for feature service legend of text symbols');
        }
    } catch (e) {
        console.error('Issue encountered when converting symbol to legend image', e);
        label = 'Error!';
    }
    return { label, imageData, contentType, base };
}

/**
* Generate an array of legend items for an ESRI unique value or class breaks renderer.
* @private
* @param  {Object} renderer an ESRI unique value or class breaks renderer
* @param  {Array} childList array of children items of the renderer
* @return {Array} a legend object populated with the symbol and label
*/
function scrapeListRenderer(renderer, childList) {
    const legend = childList.map(child => {
        return symbolToLegend(child.symbol, child.label);
    });

    if (renderer.defaultSymbol) {
        // class breaks dont have default label
        // TODO perhaps put in a default of "Other", would need to be in proper language
        legend.push(symbolToLegend(renderer.defaultSymbol, renderer.defaultLabel || ''));
    }

    return legend;
}

/**
* Generate a legend object based on an ESRI renderer.
* @private
* @param  {Object} renderer an ESRI renderer object in server JSON form
* @param  {Integer} index the layer index of this renderer
* @return {Object} an object matching the form of an ESRI REST API legend
*/
function rendererToLegend(renderer, index) {
    // make basic shell object with .layers array
    const legend = {
        layers: [{
            layerId: index,
            legend: []
        }]
    };

    switch (renderer.type) {
        case SIMPLE:
            legend.layers[0].legend.push(symbolToLegend(renderer.symbol, renderer.label));
            break;

        case UNIQUE_VALUE:
            legend.layers[0].legend = scrapeListRenderer(renderer, renderer.uniqueValueInfos);
            break;

        case CLASS_BREAKS:
            legend.layers[0].legend = scrapeListRenderer(renderer, renderer.classBreakInfos);
            break;

        default:

            // FIXME make a basic blank entry (error msg as label?) to prevent things from breaking
            // Renderer we dont support
            console.error('encountered unsupported renderer legend type: ' + renderer.type);
    }
    return legend;
}

// TODO getZoomLevel should probably live in a file not named symbology
/**
* Takes the lod list and finds level as close to and above scale limit
*
* @param {Array} lods array of esri LODs https://developers.arcgis.com/javascript/jsapi/lod-amd.html
* @param {Integer} maxScale object largest zoom level for said layer
* @returns {Number} current LOD
*/
function getZoomLevel(lods, maxScale) {
    // Find level as close to and above scaleLimit
    const scaleLimit = maxScale; // maxScale obj in returned config
    let found = false;
    let currentLod = Math.ceil(lods.length / 2);
    let lowLod = 0;
    let highLod = lods.length - 1;

    if (maxScale === 0) {
        return lods.length - 1;
    }

    // Binary Search
    while (!found) {
        if (lods[currentLod].scale >= scaleLimit) {
            lowLod = currentLod;
        } else {
            highLod = currentLod;
        }
        currentLod = Math.floor((highLod + lowLod) / 2);
        if (highLod === lowLod + 1) {
            found = true;
        }
    }
    return currentLod;
}

module.exports = function () {
    return {
        getGraphicIcon,
        getGraphicSymbol,
        rendererToLegend,
        getZoomLevel,
        enhanceRenderer
    };
};