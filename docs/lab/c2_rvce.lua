-- Pandoc Lua filter for the Component 2 SRS (C2_SRS.md).
--   ::: cover     -> RVCE cover page (centred block, then a page break)
--   ::: toc       -> table of contents at that point (LaTeX \tableofcontents; a Word TOC field)
--   ::: pagebreak -> page break
-- Used for both the PDF (LaTeX) and the DOCX build, so the two outputs have the same front matter.

local function docx_pagebreak()
  return pandoc.RawBlock('openxml', '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
end

local function docx_toc()
  return pandoc.RawBlock('openxml', table.concat({
    '<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>',
    '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>',
    '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r>',
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    '<w:r><w:t>Open in Word and choose Update Field to build the table of contents.</w:t></w:r>',
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'}))
end

local function set_style(blocks, style)
  local out = {}
  for _, b in ipairs(blocks) do
    if b.t == 'Para' or b.t == 'Plain' then
      table.insert(out, pandoc.Div({b}, pandoc.Attr('', {}, {{'custom-style', style}})))
    else
      table.insert(out, b)
    end
  end
  return out
end

function Div(el)
  local fmt = FORMAT
  if el.classes:includes('cover') then
    if fmt:match('latex') then
      local blocks = {pandoc.RawBlock('latex', '\\begin{titlepage}\\centering\\thispagestyle{empty}')}
      for _, b in ipairs(el.content) do table.insert(blocks, b) end
      table.insert(blocks, pandoc.RawBlock('latex', '\\end{titlepage}'))
      return blocks
    elseif fmt:match('docx') then
      local blocks = set_style(el.content, 'Cover')
      table.insert(blocks, docx_pagebreak())
      return blocks
    end
  elseif el.classes:includes('toc') then
    if fmt:match('latex') then
      return {pandoc.RawBlock('latex', '\\tableofcontents\\clearpage')}
    elseif fmt:match('docx') then
      return {docx_toc(), docx_pagebreak()}
    end
    return {}
  elseif el.classes:includes('pagebreak') then
    if fmt:match('latex') then
      return {pandoc.RawBlock('latex', '\\clearpage')}
    elseif fmt:match('docx') then
      return {docx_pagebreak()}
    end
    return {}
  end
end
