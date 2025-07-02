# Service Fee Feature Requirements

## Overview
Add support for mandatory service fees (common in cities like SF) that appear on restaurant bills.

## UI Changes
- Add new "Service Fee" input box positioned between Tax and Tip lines in the check review section
- Service fee input should match existing tax/tip input styling with number input and percentage display
- Update the tip calculation toggle checkbox text from "Tip percentage includes tax" to "Tip percentage includes tax and service fee"

## State Management
- Add new state variable `serviceFee` (string, default '0.00')
- Add `setServiceFee` setter function
- Include service fee in all total calculations

## Calculation Updates
- **Subtotal**: Remains sum of all items (unchanged)
- **Grand Total**: Subtotal + Tax + Service Fee + Tip
- **Tip Base Calculation**: 
  - If toggle OFF: Tip = (Subtotal) × percentage
  - If toggle ON: Tip = (Subtotal + Tax + Service Fee) × percentage
- **Split Calculations**: Service fee should be proportionally distributed among party members based on their item totals (same logic as tax)

## Input Handling
- Add `handleServiceFeeBlur()` function for formatting to 2 decimal places
- Add `updateServiceFeeAndTotal()` function for real-time updates
- Service fee should clear selected tip percentage when manually edited (same behavior as tax/tip)

## Display Features
- Show implied service fee percentage relative to subtotal (matching tax display)
- Include service fee in final split breakdown for each person
- Include service fee in share results modal (both simple and detailed views)

## OCR Integration
- Service fee detection in `parseCheckText()` function (look for keywords like "service fee", "service charge", "auto gratuity")
- Add service fee parsing to `ocr-parser.js`

## Validation
- Service fee must be non-negative number
- Format to 2 decimal places on blur
- Handle empty/invalid input gracefully