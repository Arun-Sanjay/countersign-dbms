--[[
Page layout for C3_ER (pandoc Lua filter, used for both the PDF and the DOCX build).

  ::: {page=a3l}            A fenced div with a "page" attribute is set on its own page(s):
  ![Fig. ...](x.png)          a4p = A4 portrait, a4l = A4 landscape, a3l = A3 landscape.
  :::                         The rest of the document is A4 portrait (margins 20 mm).

PDF  : \setpaper (c3_header.tex) changes the paper size and text block for the div;
       each figure is the vector PDF, scaled to fill the text block (no height cap below
       the page), with its caption under it.
DOCX : real Word sections. A section break before the div closes the A4 portrait section,
       one after it closes the div's own section (A3/A4, landscape where needed). Each
       figure gets the largest width that fits the section's text block.

Figure sizes (inches) come from diagrams/c3/fig_sizes.txt, written by render.sh.
]]

local BASE = { pw = 210, ph = 297, m = 20 }
local PAGES = {
  a4p = { pw = 210, ph = 297, m = 12 },
  a4l = { pw = 297, ph = 210, m = 12 },
  a3l = { pw = 420, ph = 297, m = 10 },
}

local sizes = {}
do
  local f = io.open("diagrams/c3/fig_sizes.txt", "r")
  if f then
    for line in f:lines() do
      local n, w, h = line:match("^(%S+)%s+([%d.]+)%s+([%d.]+)")
      if n then sizes[n] = { tonumber(w), tonumber(h) } end
    end
    f:close()
  end
end

local function twips(mm) return math.floor(mm * 56.6929 + 0.5) end

local function sect_xml(p)
  local orient = (p.pw > p.ph) and ' w:orient="landscape"' or ''
  return string.format(
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>' ..
    '<w:sectPr><w:pgSz w:w="%d" w:h="%d"%s/>' ..
    '<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="567" w:footer="567" w:gutter="0"/>' ..
    '<w:pgNumType/></w:sectPr></w:pPr></w:p>',
    twips(p.pw), twips(p.ph), orient, twips(p.m), twips(p.m), twips(p.m), twips(p.m))
end

local function tex_page(p)
  return string.format('\\setpaper{%dmm}{%dmm}{%dmm}', p.pw, p.ph, p.m)
end

local function stem(src) return src:match("([^/]+)%.png$") end

-- fit a figure into the text block of page p (inches), leaving room for its caption
local function fit_width(name, p, docx)
  local s = sizes[name]
  if not s then return nil end
  local tw = (p.pw - 2 * p.m) / 25.4
  local th = (p.ph - 2 * p.m) / 25.4 - (docx and 1.1 or 0.75)   -- caption (+ Word's spacing)
  local k = math.min(tw / s[1], th / s[2])
  return s[1] * k
end

local function figure_parts(block)
  -- returns image, caption-inlines for a Figure block or a Para holding one Image
  if block.t == "Figure" then
    local img
    block.content:walk({ Image = function(i) img = i end })
    local cap = {}
    if block.caption and block.caption.long and #block.caption.long > 0 then
      cap = pandoc.utils.blocks_to_inlines(block.caption.long)
    elseif img then
      cap = img.caption
    end
    return img, cap
  elseif (block.t == "Para" or block.t == "Plain") and #block.content == 1 and block.content[1].t == "Image" then
    return block.content[1], block.content[1].caption
  end
  return nil
end

local function latex_figure(img, cap)
  local pdf = img.src:gsub("%.png$", ".pdf")
  local captex = pandoc.write(pandoc.Pandoc({ pandoc.Plain(cap) }), "latex")
  return pandoc.RawBlock("latex",
    "\\begin{center}\n" ..
    "\\includegraphics[width=\\linewidth,height=\\dimexpr\\textheight-3.2\\baselineskip\\relax,keepaspectratio]{" ..
    pdf .. "}\\par\\vspace{3pt}\n" ..
    "\\parbox{\\linewidth}{\\centering\\small " .. captex .. "}\n" ..
    "\\end{center}")
end

local function page_div(el, after_page_div)
  local page = el.attributes["page"]
  local P = PAGES[page]
  assert(P, "unknown page type " .. page)
  local out = {}
  if FORMAT:match("latex") then
    table.insert(out, pandoc.RawBlock("latex", tex_page(P)))
  elseif FORMAT:match("docx") and not after_page_div then
    -- close the running A4 portrait section (not needed right after another page div:
    -- that one has already closed its own section, and an extra break would leave an
    -- empty A4 page)
    table.insert(out, pandoc.RawBlock("openxml", sect_xml(BASE)))
  end
  for _, b in ipairs(el.content) do
    local img, cap = figure_parts(b)
    if img and FORMAT:match("latex") then
      table.insert(out, latex_figure(img, cap))
    elseif img and FORMAT:match("docx") then
      local w = fit_width(stem(img.src), P, true)
      table.insert(out, b:walk({ Image = function(i)     -- walk returns a new block
        if w then
          i.attributes["width"] = string.format("%.2fin", w)
          i.attributes["height"] = nil
        end
        i.src = i.src:gsub("diagrams/c3/", "diagrams/c3/docx/")
        return i
      end }))
    else
      table.insert(out, b)
    end
  end
  if FORMAT:match("latex") then
    table.insert(out, pandoc.RawBlock("latex", tex_page(BASE)))
  elseif FORMAT:match("docx") then
    table.insert(out, pandoc.RawBlock("openxml", sect_xml(P)))
  end
  return out
end

-- page divs are top-level blocks; walk them in order so consecutive ones share breaks
function Pandoc(doc)
  local blocks = {}
  local prev_page = false
  for _, b in ipairs(doc.blocks) do
    if b.t == "Div" and b.attributes["page"] then
      for _, x in ipairs(page_div(b, prev_page)) do table.insert(blocks, x) end
      prev_page = true
    else
      table.insert(blocks, b)
      prev_page = false
    end
  end
  doc.blocks = blocks
  return doc
end

-- figures outside page divs (inline in the A4 portrait text)
function Image(img)
  if not img.src:match("^diagrams/c3/[^/]*%.png$") then return nil end   -- not yet handled
  if FORMAT:match("latex") then
    img.src = img.src:gsub("%.png$", ".pdf")
    return img
  elseif FORMAT:match("docx") then
    local w = fit_width(stem(img.src), BASE, true)
    if w and not img.attributes["width"] then img.attributes["width"] = string.format("%.2fin", w) end
    img.src = img.src:gsub("diagrams/c3/", "diagrams/c3/docx/")
    return img
  end
end

return { { Pandoc = Pandoc }, { Image = Image } }
