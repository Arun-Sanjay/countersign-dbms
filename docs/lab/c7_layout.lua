--[[
Page layout for the Component 7 Midterm Report (pandoc Lua filter; PDF and DOCX).
Runs after c2_rvce.lua (cover, toc, pagebreak divs), and follows c3_layout.lua:

  ::: {page=a3l}            A fenced div with a "page" attribute is set on its own page(s):
  ![Figure n. ...](x.png)     a4p = A4 portrait, a4l = A4 landscape, a3l = A3 landscape.
  :::                         The rest of the document is A4 portrait.

PDF  : \setpaper (c7_header.tex) changes the paper size and text block for the div; each figure
       is scaled to fill the text block (the vector .pdf is used when one exists next to the
       .png, as for the Component 3 diagrams).
DOCX : real Word sections (a section break before and after the div). Each figure gets the
       largest width that fits its section's text block, computed from the PNG's pixel size.
Figures outside page divs: {width=N%} is converted to an absolute width of the A4 portrait
text block (15.92 cm in the DOCX), because the DOCX reference page is A3 landscape (so that
pandoc does not shrink the A3 figures; build_c7.sh sets the last section back to A4 portrait).
]]

local BASE_PDF  = { pw = 210, ph = 297, m = 20 }
local BASE_DOCX = { pw = 210, ph = 297, m = 25.4 }
local PAGES = {
  a4p = { pw = 210, ph = 297, m = 12 },
  a4l = { pw = 297, ph = 210, m = 12 },
  a3l = { pw = 420, ph = 297, m = 10 },
}

local function png_size(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local head = f:read(24)
  f:close()
  if not head or #head < 24 then return nil end
  local function u32(i)
    local a, b, c, d = head:byte(i, i + 3)
    return ((a * 256 + b) * 256 + c) * 256 + d
  end
  return u32(17), u32(21)
end

local function exists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

local function twips(mm) return math.floor(mm * 56.6929 + 0.5) end

local function sect_xml(p)
  local orient = (p.pw > p.ph) and ' w:orient="landscape"' or ''
  return string.format(
    '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr>' ..
    '<w:sectPr><w:pgSz w:w="%d" w:h="%d"%s/>' ..
    '<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="567" w:footer="567" w:gutter="0"/>' ..
    '</w:sectPr></w:pPr></w:p>',
    twips(p.pw), twips(p.ph), orient, twips(p.m), twips(p.m), twips(p.m), twips(p.m))
end

-- fit an image (pixel size w x h) into the text block of page p; returns inches
local function fit_width(src, p, caption_mm)
  local w, h = png_size(src)
  if not w then return nil end
  local tw = (p.pw - 2 * p.m) / 25.4
  local th = (p.ph - 2 * p.m - caption_mm) / 25.4
  return math.min(tw, th * w / h)
end

local function figure_parts(block)
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
  local src = img.src
  local pdf = src:gsub("%.png$", ".pdf")
  if pdf ~= src and exists(pdf) then src = pdf end
  local captex = pandoc.write(pandoc.Pandoc({ pandoc.Plain(cap) }), "latex")
  return pandoc.RawBlock("latex",
    "\\begin{center}\n" ..
    "\\includegraphics[width=\\linewidth,height=\\dimexpr\\textheight-4.2\\baselineskip\\relax,keepaspectratio]{" ..
    src .. "}\\par\\vspace{3pt}\n" ..
    "\\parbox{\\linewidth}{\\centering\\small " .. captex .. "}\n" ..
    "\\end{center}")
end

local function page_div(el, after_page_div)
  local P = PAGES[el.attributes["page"]]
  assert(P, "unknown page type " .. tostring(el.attributes["page"]))
  local out = {}
  if FORMAT:match("latex") then
    table.insert(out, pandoc.RawBlock("latex",
      string.format("\\setfigpaper{%dmm}{%dmm}{%dmm}", P.pw, P.ph, P.m)))
  elseif FORMAT:match("docx") and not after_page_div then
    table.insert(out, pandoc.RawBlock("openxml", sect_xml(BASE_DOCX)))
  end
  for _, b in ipairs(el.content) do
    local img, cap = figure_parts(b)
    if img and FORMAT:match("latex") then
      table.insert(out, latex_figure(img, cap))
    elseif img and FORMAT:match("docx") then
      local w = fit_width(img.src, P, 30)
      table.insert(out, b:walk({ Image = function(i)
        if w then
          i.attributes["width"] = string.format("%.2fin", w)
          i.attributes["height"] = nil
        end
        return i
      end }))
    else
      table.insert(out, b)
    end
  end
  if FORMAT:match("latex") then
    table.insert(out, pandoc.RawBlock("latex", "\\setbasepaper"))
  elseif FORMAT:match("docx") then
    table.insert(out, pandoc.RawBlock("openxml", sect_xml(P)))
  end
  return out
end

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

-- figures in the running A4 portrait text (DOCX only: absolute widths)
function Image(img)
  if not FORMAT:match("docx") then return nil end
  local tw = (BASE_DOCX.pw - 2 * BASE_DOCX.m) / 25.4
  local pct = img.attributes["width"] and img.attributes["width"]:match("^([%d.]+)%%$")
  if pct then
    img.attributes["width"] = string.format("%.2fin", tw * tonumber(pct) / 100)
  elseif not img.attributes["width"] then
    local w = fit_width(img.src, BASE_DOCX, 30)
    if w then img.attributes["width"] = string.format("%.2fin", w) end
  end
  return img
end

return { { Pandoc = Pandoc }, { Image = Image } }
