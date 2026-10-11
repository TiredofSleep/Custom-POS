# Ozark Print Agent — prints a plain-text invoice (monospace) to a named printer,
# with a REAL scannable Code 39 barcode (order number) where the agent inserted a
# [[BARCODE]] marker, and the racked location printed LARGE at the bottom.
# Built-in Windows only (System.Drawing).
#
# Tuned for 80mm thermal receipt printers (EPSON TM-T88): OriginAtMargins=$false so
# the graphics origin is the printable-area top-left, drawing from ~0 across the
# printable WIDTH; the body font auto-shrinks so the widest line fits the roll.
param(
  [string]$TextFile,
  [string]$Printer,
  [string]$Rack = "",
  [int]$Copies = 1,
  [string]$Barcode = "",
  [string]$Pieces = "",
  [string]$QRFile = ""
)
Add-Type -AssemblyName System.Drawing

$text  = [System.IO.File]::ReadAllText($TextFile)
$lines = $text -split "`r?`n"

# Optional QR (route invoices): a PNG of the order # the POS rendered at 1px/module. Loaded via a
# MemoryStream (not FromFile) so the temp file isn't locked while printing. Drawn NearestNeighbor so the
# integer upscale keeps modules razor-sharp on 1-bit thermal paper → a phone camera reads it instantly.
$script:qrImg = $null
if ($QRFile -and (Test-Path $QRFile)) {
  try { $qrBytes = [System.IO.File]::ReadAllBytes($QRFile); $qrMs = New-Object System.IO.MemoryStream(,$qrBytes); $script:qrImg = [System.Drawing.Image]::FromStream($qrMs) } catch { $script:qrImg = $null }
}

# Code 128 module-width patterns, values 0..106 (each 6 elements = 11 modules;
# value 106 = Stop, 7 elements = 13 modules). Continuous: even index = bar.
$C128 = @(
 '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
 '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
 '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
 '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
 '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
 '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
 '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
 '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
 '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
 '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
 '114131','311141','411131','211412','211214','211232','2331112'
)
# Encode an ASCII string in Code 128 subset B (with checksum). Returns the list of code values.
function Get-Code128B([string]$data) {
  $vals = New-Object System.Collections.Generic.List[int]
  $vals.Add(104)            # Start B
  $sum = 104; $pos = 1
  foreach ($ch in $data.ToCharArray()) {
    $code = [int][char]$ch
    if ($code -lt 32 -or $code -gt 126) { continue }
    $v = $code - 32
    $vals.Add($v); $sum += $pos * $v; $pos++
  }
  $vals.Add($sum % 103)     # checksum
  $vals.Add(106)            # Stop
  return $vals
}

$pd = New-Object System.Drawing.Printing.PrintDocument
$pd.DocumentName = "Ozark Invoice"
try { $pd.PrinterSettings.PrinterName = $Printer } catch {}
if (-not $pd.PrinterSettings.IsValid) { [Console]::Error.WriteLine("Printer not found: $Printer"); exit 2 }
if ($Copies -gt 1) { $pd.PrinterSettings.Copies = [int16]$Copies }

# With OriginAtMargins = $false, the Graphics origin (0,0) is the top-left of the
# printer's printable area; we draw from ~0 using the printable WIDTH.
$pd.OriginAtMargins = $false

$script:idx      = 0
$script:rackDone = $false
$script:bodyFont = $null
$script:rackFont = $null

$pd.add_PrintPage({
  param($s, $e)
  $g      = $e.Graphics
  # Thermal printers are 1-bit (pure black/white). Antialiased text renders as fuzzy gray
  # dots = "bad quality". Force crisp single-bit text + no smoothing for sharp, dark output.
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $pa     = $e.PageSettings.PrintableArea
  $left   = [single]2
  $top    = [single]2
  $bottom = [single]($pa.Height - 2)
  $printW = [single]($pa.Width - 6)

  # First page: pick fonts that FIT the printable width (auto-shrink to the roll).
  if (-not $script:bodyFont) {
    $longest = " "
    foreach ($ln in $lines) {
      $probe = $ln; if ($probe.Trim() -eq '[[BARCODE]]') { $probe = " " }
      if ($probe.Length -gt $longest.Length) { $longest = $probe }
    }
    # Start big and readable; only shrink to fit, never below a comfortable floor.
    $size = 14.0
    $bf   = New-Object System.Drawing.Font("Consolas", $size, [System.Drawing.FontStyle]::Bold)   # Bold = darker, more legible on thermal
    $w    = $g.MeasureString($longest, $bf).Width
    if ($w -gt $printW -and $w -gt 0) {
      $size = [Math]::Max(10.0, [Math]::Floor($size * ($printW / $w) * 10) / 10)
      $bf.Dispose()
      $bf = New-Object System.Drawing.Font("Consolas", $size, [System.Drawing.FontStyle]::Bold)
    }
    $script:bodyFont = $bf

    $rsize    = $size * 2.0
    $rf       = New-Object System.Drawing.Font("Consolas", $rsize, [System.Drawing.FontStyle]::Bold)
    $rackText = if ($Rack -match '^(?i)stop\b') { $Rack } else { "RACK:  $Rack" }
    $rw       = $g.MeasureString($rackText, $rf).Width
    if ($rw -gt $printW -and $rw -gt 0) {
      $rsize = [Math]::Max(6.0, [Math]::Floor($rsize * ($printW / $rw) * 10) / 10)
      $rf.Dispose()
      $rf = New-Object System.Drawing.Font("Consolas", $rsize, [System.Drawing.FontStyle]::Bold)
    }
    $script:rackFont = $rf

    # 👤 The *BIG* name gets its OWN font (2026-09-01, Bakri). It used to borrow $rackFont — which shrinks
    # to fit the RACK text — so a long rack location ("under rack, 3 poly bags") silently shrank the
    # customer's NAME back to body size. The name's font only shrinks when the NAME itself is too wide.
    $script:bigFont = New-Object System.Drawing.Font("Consolas", ($size * 2.0), [System.Drawing.FontStyle]::Bold)
  }

  $bodyFont = $script:bodyFont
  $rackFont = $script:rackFont
  $bigFont  = $script:bigFont
  $lh       = $bodyFont.GetHeight($g)
  $rh       = $rackFont.GetHeight($g)
  $bcH      = [single]95   # barcode bar height (hundredths of an inch) — taller = faster camera scans on the route
  $y        = $top

  while ($script:idx -lt $lines.Length) {
    $line = $lines[$script:idx]

    # Barcode marker -> draw a real Code 128 barcode + the readable order number.
    if ($line.Trim() -eq '[[BARCODE]]') {
      # Route QR (if provided) prints ABOVE the Code 128 — big + crisp for a phone camera.
      if ($script:qrImg -ne $null) {
        $qrSize = [single]150   # ~1.5 inch (hundredths of an inch) — large, easy phone scan
        if ($qrSize -gt $printW) { $qrSize = [single]$printW }
        if ($y + $qrSize + $bcH + $lh + 12 -gt $bottom) { $e.HasMorePages = $true; return }
        $qx = [single]($left + [Math]::Max(0.0, ($printW - $qrSize) / 2))
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $g.DrawImage($script:qrImg, $qx, [single]$y, $qrSize, $qrSize)
        $y += $qrSize + 5
      }
      $data = ($Barcode.Trim())
      if ($data.Length -gt 0) {
        if ($y + $bcH + $lh + 6 -gt $bottom) { $e.HasMorePages = $true; return }
        $vals = Get-Code128B $data
        # total modules: 11 per symbol, except Stop (last) = 13.
        $totalMods = 11 * ($vals.Count - 1) + 13
        # ⚠️ A MODULE MUST BE A WHOLE NUMBER OF PRINTER DOTS OR THE BARCODE WILL NOT SCAN.
        # The head is 1-bit at a fixed dpi (203 on the Epson), so every bar edge is rounded to a
        # dot. A fractional module (this was 2.567 dots for a 15-char order number) prints the
        # 1:2:3:4 elements as ~3:5:8:10 — crisp, black, beautiful, and undecodable. Thermal bleed
        # then closes the narrow spaces entirely. Short codes happened to land near a whole dot and
        # scanned, which is why this read as "some barcodes work".
        $dpi = 203
        try { $r = $e.PageSettings.PrinterResolution.X; if ($r -gt 0) { $dpi = $r } } catch {}
        $availDots = ($printW / 100.0) * $dpi
        $dotsPerMod = [Math]::Floor($availDots / ($totalMods + 20))   # +20 = quiet zone (~10 modules each side)
        if ($dotsPerMod -lt 2) { $dotsPerMod = 2 }                    # 2 dots @203dpi ≈ 9.9 mils, inside Code 128 spec
        if ($dotsPerMod -gt 5) { $dotsPerMod = 5 }                    # wide enough; past this it just eats paper
        $module = ($dotsPerMod * 100.0) / $dpi                        # back to hundredths of an inch, now dot-exact
        $barsW = $totalMods * $module
        # Start on an exact dot boundary too, so the whole symbol stays in phase with the head.
        $startDots = [Math]::Floor(((($left + [Math]::Max(0, ($printW - $barsW) / 2)) / 100.0) * $dpi))
        $dotPos = [double]$startDots
        foreach ($v in $vals) {
          $pat = $C128[$v]
          for ($j = 0; $j -lt $pat.Length; $j++) {
            $wdtDots = ([int]([string]$pat[$j])) * $dotsPerMod
            if ($j % 2 -eq 0) {
              $x0 = [single](($dotPos / $dpi) * 100.0)
              $w0 = [single](($wdtDots / $dpi) * 100.0)
              $g.FillRectangle([System.Drawing.Brushes]::Black, $x0, [single]$y, $w0, $bcH)
            }
            $dotPos += $wdtDots
          }
        }
        # Readable order number is printed once on the "Order:" line below — don't repeat it here.
        $y += $bcH + $lh
      }
      $script:idx++
      continue
    }

    # 👤 A *BIG* line (the customer name) draws DOUBLE SIZE with the rack font, centered — owner 2026-08-28.
    if ($line.StartsWith('*BIG*')) {
      $bt = $line.Substring(5)
      $bf2 = $bigFont
      $btw = $g.MeasureString($bt, $bf2).Width
      if ($btw -gt $printW -and $btw -gt 0) {
        # only a NAME too wide for the paper shrinks — never somebody else's rack line
        $bsz = [Math]::Max(6.0, [Math]::Floor($bigFont.Size * ($printW / $btw) * 10) / 10)
        $bf2 = New-Object System.Drawing.Font("Consolas", $bsz, [System.Drawing.FontStyle]::Bold)
        $btw = $g.MeasureString($bt, $bf2).Width
      }
      $bh = $bf2.GetHeight($g)
      $reserveB = $rh + $lh; if ($Pieces) { $reserveB += $rh }
      if ($y + $bh -gt $bottom - $reserveB) { $e.HasMorePages = $true; return }
      $bx = [single]($left + [Math]::Max(0, ($printW - $btw) / 2))
      $g.DrawString($bt, $bf2, [System.Drawing.Brushes]::Black, $bx, [single]$y)
      $y += $bh
      $script:idx++
      continue
    }

    # Body line. Reserve room for the big RACK line (and the PIECES line) so they aren't clipped.
    $reserve = $rh + $lh; if ($Pieces) { $reserve += $rh }
    if ($y + $lh -gt $bottom - $reserve) { $e.HasMorePages = $true; return }
    $g.DrawString($line, $bodyFont, [System.Drawing.Brushes]::Black, [single]$left, [single]$y)
    $y += $lh
    $script:idx++
  }

  # Racked location + piece count — LARGE, right after the body.
  if (-not $script:rackDone -and ($Rack -or $Pieces)) {
    $y += $lh
    if ($Rack)   { $rackLine = if ($Rack -match '^(?i)stop\b') { $Rack } else { "RACK:  $Rack" }; $g.DrawString($rackLine, $rackFont, [System.Drawing.Brushes]::Black, [single]$left, [single]$y); $y += $rh }
    if ($Pieces) { $g.DrawString("PIECES:  $Pieces", $rackFont, [System.Drawing.Brushes]::Black, [single]$left, [single]$y) }
    $script:rackDone = $true
  }
  $e.HasMorePages = $false
})

$pd.Print()
if ($script:qrImg -ne $null) { try { $script:qrImg.Dispose() } catch {} }
