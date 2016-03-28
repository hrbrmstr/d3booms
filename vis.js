/*
  Lovingly handcrafted by @hrbrmstr
  Copyright (c) 2016, Bob Rudis
  MIT License
*/ 

var width = 960, height = 543;

// read in & draw the world map
// in R this would be
// world <- ggplot2::map_data("world")
// ggplot() + 
//   geom_map(data=world, map=world, 
//            aes(x=long, y=lat, map_id=region),
//            color="#bfbfbf", size=0.15, fill="2b2b2b") +
//   ggalt::coord_proj("+proj=wintri")
// i rly don't like the fidgeting one has to do to get each projection right

var proj = d3.geo.winkel3().scale(182)
                 .translate([width / 2, height / 2])
                 .precision(.1);

var path = d3.geo.path().projection(proj);

var svg = d3.select("#map").append("svg")
    .attr("width", width)
    .attr("height", height);

// alternatively, this could also be (in R):
// world <- readOGR("countries.topo.json", "countries")
d3.json("countries.topo.json", function(error, world) {
  
  if (error) throw error;
  
  // draw each country from the topojson
  svg.append("g")
     .attr("id", "countries")
     .selectAll("path")
     .data(topojson.feature(world, world.objects.countries).features)
     .enter()
     .append("path")
     .attr("id", function(d) { return d.id; })
     .attr("class", "country")
     .attr("d", path)

});

// all this for a @#$#$@# bar chart; it makes you appreciate the
// work that ggplot2 does under the covers
var margin = { top: 15, right: 30, bottom: 30, left: 40 };
var bars_width = 960 - margin.left - margin.right;
var bars_height = 150 - margin.top - margin.bottom;
var bars_x = d3.scale.ordinal().rangeRoundBands([0, bars_width], 0.4, 0.2);
var bars_y = d3.scale.linear().range([bars_height, 0]);
var x_axis = d3.svg.axis().scale(bars_x).orient("bottom").tickSize(0).tickPadding(10);
var y_axis = d3.svg.axis().scale(bars_y).orient("left").ticks(5);
var bar_chart = d3.select("#barchart")
                   .append("svg")
                   .attr("width", bars_width + margin.left + margin.right)
                   .attr("height", bars_height + margin.top + margin.bottom)
                   .append("g")
                   .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

// ES6 hack for ranges (e.g.) 1..10, 2..8, 3..10 in R
var rng = (left, right) => new Array(right - left).fill().map((_, n) => n + left);

// very format-specific date conversion (we don't really need this tho)
// in R this would be
// as.Date(x, format="%Y%m%d")
var as_Date = d3.time.format("%Y%m%d").parse;

// these names makes it easier for me to remember what the scales do
var scale_color_brewer = d3.scale.ordinal();
var scale_size_radius = d3.scale.quantize().range(rng(3, 10));

var process_nuclear = function(events) {

  // clean up the raw data from the CSV file
  // we pre-compute the projected long/lat here to shave a cpl cycles later
  var mod = events.map(function(evt) {
     var p = proj([+evt.longitude, +evt.latitude]) ;
     return({
       date : as_Date(evt.date_long), // as i said, this rly isn't necessary
       year : evt.year,
       long : +evt.longitude,
       lat : +evt.latitude,
       plong : p[0],
       plat : p[1],
       country : (evt.country == "PAKIST") ? "PAKISTAN" : evt.country
     });   
  });

  // get a county by year/lat/long/country
  // in R this would be:
  // dplyr::count(dat, country, long, lat, year)
  booms_by_year = d3.nest()
    .key(function(d) { return d.year; })
    .key(function(d) { return [ d.long, d.lat, d.country, d.year]; })
    .rollup(function(v) { return {
      count : v.length,
      year : v[0].year,
      country : v[0].country,
      long : v[0].long,
      lat : v[0].lat,
      plong : v[0].plong,
      plat : v[0].plat 
    }; 
  }).map(mod);
  
  // we have to "unnest" that structure
  booms_by_year = d3.entries(booms_by_year).map(function(d) {
    return d3.entries(d.value).map(function(e) {
      return({
        year : e.value.year,
        count : e.value.count,
        country : e.value.country,
        plong : e.value.plong,
        plat : e.value.plat 
      });
    });
  }).reduce(function(a, b){ return a.concat(b) },[]);
  
  // for sizing the circles
  var ext2 = d3.extent(d3.values(booms_by_year), function(d) { return(d.count); })
  scale_size_radius = scale_size_radius.domain(ext2);
  
  // get unique, sorted (by total boom count) countries & map to colorbrewer color
  var countries = d3.nest()
                    .key(function(d) { return(d.country); })
                    .rollup(function(l) { return(l.length)})
                    .entries(mod)
                    .sort(function(a, b) { return(b.values - a.values); })
                    .map(function(d) { return(d.key); })
  
  scale_color_brewer = scale_color_brewer.domain(countries)
                                         .range(colorbrewer.Set1[countries.length]);
  
  // unique years
  var years = d3.set(mod.map(function(d) { return +d.year; })).values()
  
  // start laying out the booms
  var booms = svg.append("g");
  
  // and the bars
  var max_y = d3.max(d3.nest()
                        .key(function(d) { return(d.country); })
                        .rollup(function(l) { return(l.length); })
                        .entries(mod), function(d){ return(d.values); })

  // x & y domains
  bars_x.domain(countries);
  bars_y.domain([0, max_y]);
  
  bar_chart.append("g")
           .attr("class", "x axis")
           .attr("transform", "translate(0," + bars_height + ")")
           .call(x_axis);

  bar_chart.append("g")
           .attr("class", "y axis")
           .call(y_axis);

  // javascript array filter helper
  var up_to_year = function(d) { return(+d.year <= +this); }

  // every 500ms update the display
  var year_index = 0;
  var cycle_years = function() {
    
    if (year_index < years.length) {
      
      // get the actual year & update the <div>
      yr = years[year_index];
      d3.select("#year").html(yr);
      
      var by_year = booms_by_year.filter(up_to_year, yr);
      
      // draw circles
      // in R, this'd just be
      // geom_point(data=filtered_data, aes(x=long, y=lat, size=count, color=country))
      booms.selectAll(".explosions")
          .data(by_year)
          .enter()
          .append("circle")
          .attr("class", "explosions")
          .attr("cx", function(d) { return(d.plong); })
          .attr("cy", function(d) { return(d.plat);  })
          .attr("r", function(d) { return scale_size_radius(d.count); })
          .attr("stroke", function(d) { return(scale_color_brewer(d.country)); });
      
      // now creat/update the bars
      // in R, this'd just be
      // geom_bar(data=bar_dat, stat="identity", aes(x=key, y=values, color=key, width=0.5))
      var bar_dat = d3.nest()
                      .key(function(d) { return(d.country); })
                      .rollup(function(l) { return(d3.sum(l, function(d) { return (d.count); })); })
                      .entries(by_year);

      var bar = bar_chart.selectAll("g")
                         .data(bar_dat)
                         .enter()
                         .append("g")
                         .attr("transform", function(d) { return "translate(" + bars_x(d.key) + ",0)"; });

      bar_chart.selectAll(".bar")
          .data(bar_dat)
          .enter()
          .append("rect")
          .attr("class", "bar");
          
      bar_chart.selectAll(".bar")
          .attr("x", function(d) { return bars_x(d.key); })
          .attr("y", function(d) { return bars_y(d.values); })
          .attr("height", function(d) { return bars_height - bars_y(d.values); })
          .attr("width", bars_x.rangeBand())
          .style("fill", function(d) { return(scale_color_brewer(d.key)); });

      year_index += 1;
      
    } else {
      clearInterval(seq_year); // kill the timer when done w/years
    };
      
  };
    
  // start the timer
  var seq_year = setInterval(cycle_years, 200);
        
};

// read and process the CSV of explosions
d3.csv("sipri-report-explosions.csv", process_nuclear);

// in case we're <iframe>'d
d3.select(self.frameElement).style("height", "710px");
