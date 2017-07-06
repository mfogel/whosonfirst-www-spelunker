/*

This is the "UI logic" of the Bundler, handling things like button events,
preview map, and anything tightly coupled to the download page. For the business
code, take a look at mapzen.whosonfirst.bundler.js. (20170124/dphiffer)

*/

window.addEventListener("load", function load(event){

	 // Warn the user if the filesize exceeds 100MB or 250 features
	var filesize_warning = 100000000;
	var filecount_warning = 250;

	var total = 0;
	var filesize = 0;
	var bundle_count = 0;
	var summary_count = 0;

	var bundler = document.getElementById('wof-bundler');
	var status = document.getElementById('bundle-status');
	var parent_id = bundler.getAttribute('data-parent-id');
	var checkboxes = bundler.querySelectorAll('input.placetype');
	var btn_start = document.getElementById('btn-start');
	var btn_bundle = document.getElementById('btn-bundle');
	var btn_summary = document.getElementById('btn-summary');
	var summary_stats = document.getElementById('summary-stats');
	var bundle_stats = document.getElementById('bundle-stats');
	var preview_toggle = document.getElementById('preview-bundle');
	var simple_props_toggle = document.getElementById('bundle-simple-props');

	var root = document.body.getAttribute("data-abs-root-url");
	var simple_props_lookup = null;
	var simple_props_url = root + 'static/meta/simple_properties.json';
	var onsuccess = function(rsp) {
		simple_props_lookup = rsp;
	};
	var onerror = function() {
		mapzen.whosonfirst.log.error("failed to load simple_properties.json");
	};
	mapzen.whosonfirst.net.fetch(simple_props_url, onsuccess, onerror);

	var bbox = bundler.getAttribute("data-wof-bbox");
	bbox = bbox.split(",");

	map = mapzen.whosonfirst.leaflet.tangram.map_with_bbox('map', bbox);
	mapzen.whosonfirst.enmapify.render_id(map, parent_id, function(geojson) {
		mapzen.whosonfirst.enmapify.render_feature_outline(map, geojson);
	});
	window.map = map;

	var exclude, include;

	if (exclude = location.search.match(/exclude=([^&]+)/)) {
		mapzen.whosonfirst.bundler.set_filter('exclude', exclude[1]);
	}

	if (include = location.search.match(/include=([^&]+)/)) {
		mapzen.whosonfirst.bundler.set_filter('include', include[1]);
	}

	var disable_map_msg = '';
	mapzen.whosonfirst.bundler.set_handler('api_query', function(update) {
		status.innerHTML = 'Looking up ' + update.placetype + ' places (page ' + update.page + ')';
		filesize += update.filesize;
		var warning = null;
		if (filesize > filesize_warning) {
			warning = 'Your bundle will probably weigh in around <span class="hey-look">' + display_filesize(filesize, 0) + '</span>, which means the bundling process could start running slower overall.';
		} else if (update.count > filecount_warning) {
			warning = 'You have selected a <span class="hey-look">large quantity</span> of features, which could be difficult to display on the preview map.';
		}
		if (warning) {
			if (preview_toggle.checked && disable_map_msg == '') {
				preview_toggle.checked = false;
				disable_map_msg = '<span id="disabled-map"> To avoid running out of memory, <span class="hey-look">the preview map is now disabled</span>.</span>';
			}
			document.getElementById('bundle-warning').innerHTML = '<i>' + warning + disable_map_msg + '</i>';
		}
	});

	mapzen.whosonfirst.bundler.set_handler('feature_download', function(update) {
		var percent = (100 * update.bundle_count / total).toFixed(1) + '%';
		var name = update.feature.properties['wof:name'];
		if (! name) {
			name = update.feature.properties['wof:id'];
		}
		status.innerHTML = 'Bundled ' + percent + ': <span class="hey-look">' + name + '</span> (' + update.feature.properties['wof:placetype'] + ')';
		if (preview_toggle.checked) {
			render_feature(update.feature);
		}
		var ret = update.feature;
		if (simple_props_toggle.checked &&
		    simple_props_lookup) {
			ret = {
				id: update.feature.id,
				type: update.feature.type,
				properties: {},
				bbox: update.feature.bbox,
				geometry: update.feature.geometry
			};
			for (prop in simple_props_lookup) {
				if (typeof update.feature.properties[prop] != 'undefined') {
					var simple_prop = simple_props_lookup[prop];
					ret.properties[simple_prop] = update.feature.properties[prop];
				}
			}
			if (update.feature.properties['wof:hierarchy'] &&
			    update.feature.properties['wof:hierarchy'].length == 1) {
				var hier = update.feature.properties['wof:hierarchy'][0];
				ret.properties.country_id = hier.country_id;
				ret.properties.region_id = hier.region_id;
				ret.properties.locality_id = hier.locality_id;
			}
		}
		return ret;
	});

	mapzen.whosonfirst.bundler.set_handler('bundle_ready', function(update) {
		document.getElementById('bundle-btns').className = '';
		document.getElementById('stats').className = '';
		if (update.bundle.features.length != total) {
			status.innerHTML = '<i>The number of items in your bundle (' + bundle_count.toLocaleString() + ') does not match the expected ' + total.toLocaleString() + '.</i>';
		} else {
			status.innerHTML = '';
		}
		//bundle_stats.innerHTML = 'GeoJSON bundle: ' + display_filesize(update.bundle_size);
		//summary_stats.innerHTML = 'CSV summary: ' + display_filesize(update.summary_size);
	});

	mapzen.whosonfirst.bundler.set_handler('error', function(details) {
		if (details && details.error && details.error.message) {
			status.innerHTML = 'Error: ' + details.error.message;
			if (details.error.code) {
				status.innerHTML += ' (' + details.error.code + ')';
			}
		} else if (details && details.xhr && details.xhr.status == 404) {
			var feature = 'feature';
			if (details.xhr.responseURL) {
				var file = details.xhr.responseURL.match(/\/([^\/]+)$/)[1];
				feature = '<a href="' + details.xhr.responseURL + '">' + file + '</a>';
			}
			status.innerHTML = 'Error loading ' + feature;
		} else {
			status.innerHTML = 'Error: something went wrong, but I don’t know what.';
		}
	});

	preview_toggle.addEventListener('change', function(e) {
		if (e.target.checked) {
			var bundle = mapzen.whosonfirst.bundler.bundle_features();
			for (var i in bundle.features) {
				render_feature(bundle.features[i]);
			}
			var map_warning = document.getElementById('disabled-map');
			if (map_warning) {
				map_warning.className = 'hidden';
			}
		} else {
			map.eachLayer(function(layer) {
				if (layer.wof_id) {
					map.removeLayer(layer);
				}
			});
		}
	});

	var include = [];
	var include_match = window.location.search.match(/include=([^&]+)/);
	if (include_match) {
		include = include_match[1].split(',');
	}

	var checkbox_changed = function(checkbox) {
		var item = checkbox.parentNode;
		var count = item.getAttribute('data-count');
		count = parseInt(count);
		var pt = item.getAttribute('data-placetype');
		if (checkbox.checked) {
			total += count;
			if (checkbox.getAttribute('id') == 'pt-self') {
				mapzen.whosonfirst.bundler.enqueue_feature(parent_id);
			} else {
				mapzen.whosonfirst.bundler.enqueue_placetype(pt, parent_id);
			}
		} else {
			total -= count;
			mapzen.whosonfirst.bundler.dequeue_placetype(pt);
			map.eachLayer(function(layer) {
				if (layer.placetype == pt) {
					map.removeLayer(layer);
				}
			});
		}
		var plural = (total == 1) ? '' : 's';
		document.getElementById('selected-count').innerHTML = 'You have selected <span class="hey-look">' + total.toLocaleString() + '</span> feature' + plural + '.';
		if (total > 0) {
			if (total > mapzen.whosonfirst.bundler.feature_count_limit) {
				document.getElementById('selected-count').innerHTML += '<br><i>Please note that you currently cannot download more than ' + mapzen.whosonfirst.bundler.feature_count_limit.toLocaleString() + ' features of a given placetype at a time. This is not by design, and we are working to remove the limit.</i><br>';
			}
			document.getElementById('start-btn').className = '';
			document.getElementById('bundle-controls').className = 'active';
		} else {
			document.getElementById('start-btn').className = 'hidden';
			document.getElementById('bundle-controls').className = '';
		}
	};

	for (var i = 0; i < checkboxes.length; i++){
		var item = checkboxes[i].parentNode;
		var pt = item.getAttribute('data-placetype');
		checkboxes[i].checked = include.indexOf(pt) != -1;
		if (checkboxes[i].checked) {
			checkbox_changed(checkboxes[i]);
		}
		checkboxes[i].addEventListener('change', function(e){
			checkbox_changed(e.target);
		}, false);
		checkboxes[i].removeAttribute('disabled');
	}
	simple_props_toggle.removeAttribute('disabled');

	btn_start.addEventListener('click', function(e) {
		status.innerHTML = 'Preparing to bundle';
		mapzen.whosonfirst.bundler.bundle();
		document.getElementById('start-btn').className = 'hidden';
		for (var i = 0; i < checkboxes.length; i++) {
			checkboxes[i].setAttribute('disabled', 'disabled');
		}
		simple_props_toggle.setAttribute('disabled', 'disabled');
		document.getElementById('cancel-download').className = '';
		document.getElementById('output').className = '';
	});

	document.getElementById('cancel-download').addEventListener('click', function(e) {
		e.preventDefault();
		mapzen.whosonfirst.bundler.pause();
		document.getElementById('btn-start').innerHTML = 'Resume download';
		document.getElementById('start-btn').className = '';
		document.getElementById('cancel-download').className = 'hidden';
		document.getElementById('output').className = 'hidden';
	});

	btn_bundle.addEventListener('click', function(e) {
		e.preventDefault();
		if (btn_bundle.getAttribute('disabled') == 'disabled') {
			return;
		}
		var types = get_chosen_types().join('-');
		var simple = simple_props_toggle.checked ? '_simple' : '';
		var filename = 'wof_bundle_' + parent_id + '_' + types + simple + '.geojson';
		mapzen.whosonfirst.bundler.save_bundle(filename);
	}, false);

	btn_summary.addEventListener('click', function(e) {
		e.preventDefault();
		if (btn_summary.getAttribute('disabled') == 'disabled') {
			return;
		}
		var types = get_chosen_types().join('-');
		var filename = 'wof_bundle_' + parent_id + '_' + types + '.csv';
		mapzen.whosonfirst.bundler.save_summary(filename);
	}, false);

	function render_feature(feature) {
		var props = feature['properties'];
		var geom = feature['geometry'];

		var lat = props['geom:latitude'];
		var lon = props['geom:longitude'];

		var label_text = 'math centroid (shapely) is ';
		label_text += lat + ", " + lon;

		var pt = {
			'type': 'Feature',
			'geometry': { 'type': 'Point', 'coordinates': [ lon, lat ] },
			'properties': { 'lflt:label_text': label_text }
		};

		if (geom['type'] == 'Point'){

			var name = props['wof:name'];

			var label_text = name;
			label_text += ', whose centroid is ';
			label_text += lat + ", " + lon;

			pt['properties']['lflt:label_text'] = label_text;

			var style = mapzen.whosonfirst.leaflet.styles.math_centroid();
			var handler = mapzen.whosonfirst.leaflet.handlers.point(style);

			var layer = mapzen.whosonfirst.leaflet.draw_point(map, pt, style, handler);
		} else {

			feature['properties']['lflt:label_text'] = feature['properties']['wof:name'];
			var layer = mapzen.whosonfirst.leaflet.draw_poly(map, feature, mapzen.whosonfirst.leaflet.styles.consensus_polygon());
		}

		layer.wof_id = props['wof:id'];
		layer.placetype = props['wof:placetype'];

	}

	function get_chosen_types() {
		var types = [];
		for (var i = 0; i < checkboxes.length; i++){
			if (checkboxes[i].checked) {
				var item = checkboxes[i].parentNode;
				var placetype = item.getAttribute('data-placetype');
				types.push(placetype);
			}
		}
		return types;
	}

	function display_filesize(bytes, precision) {
		if (typeof precision == "undefined") {
			precision = 1;
		}
		if (bytes < 1024 * 1024) {
			if (Math.round(bytes / 1024) == 0) {
				return (bytes / 1024).toFixed(precision) + ' KB';
			} else {
				return Math.round(bytes / 1024) + ' KB';
			}
		} else {
			return (bytes / (1024 * 1024)).toFixed(precision) + ' MB';
		}
	}
});
