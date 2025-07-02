/**
 * Enhanced OCR Parser for Restaurant Checks
 * 
 * This module provides more robust parsing of OCR text from restaurant receipts.
 * It uses pattern matching and heuristics to extract items, tax, tip, and total.
 */

export function parseCheckText(text) {
    // Normalize text: remove extra spaces, convert to lowercase for analysis
    const lines = text.split('\n').filter(line => line.trim());
    
    // Initialize return values
    const items = [];
    let taxAmount = 0;
    let serviceFeeAmount = 0;
    let totalAmount = 0;
    let subtotalAmount = 0;
    let tipAmount = 0;
    
    // Common patterns
    const pricePattern = /\$?\s*(\d+\.\d{2})/g; // Note the 'g' flag to find all matches
    const specialCharPattern = /^[_\-=*]+|[_\-=*]+$/g;
    const percentagePattern = /[\(\-]\s*(\d+(?:\.\d+)?%)\s*[\)\-]?/;

    // First pass: identify potential section boundaries
    let itemSectionEnd = -1;
    let summarySection = [];
    
    // Look for patterns that indicate the end of items and start of summary
    for (let i = 0; i < lines.length; i++) {
        const lowerLine = lines[i].toLowerCase();
        if (lowerLine.includes('subtotal') || 
            lowerLine.includes('sub total') ||
            lowerLine.includes('sub-total') ||
            (lowerLine.includes('total') && !lowerLine.includes('grand')) ||
            lowerLine.match(/^tax/) ||
            lowerLine.includes('sales tax') ||
            lowerLine.match(/^tip/) ||
            lines[i].match(/^[\-_=\*]{3,}/) || // separator lines
            lowerLine.match(/^total\s*$/)) {
            if (itemSectionEnd === -1) {
                itemSectionEnd = i;
            }
            summarySection.push(i);
        }
    }

    // Process each line with section awareness
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const isInSummarySection = itemSectionEnd !== -1 && i >= itemSectionEnd;
        
        // Find all price matches in the line
        const priceMatches = [...line.matchAll(pricePattern)];
        
        if (priceMatches.length > 0) {
            // Use the last price in the line as the actual amount
            const lastPriceMatch = priceMatches[priceMatches.length - 1];
            const price = parseFloat(lastPriceMatch[1]);
            
            // Extract item name (everything before the last price)
            let itemName = line.substring(0, lastPriceMatch.index).trim();
            itemName = itemName.replace(specialCharPattern, '').trim();
            
            // Check for percentage in the item name
            const percentageMatch = itemName.match(percentagePattern);
            if (percentageMatch) {
                // Keep the percentage in the name but clean up the formatting
                const percentage = percentageMatch[1];
                itemName = itemName.replace(percentagePattern, ` (${percentage})`);
            }
            
            // Skip if item name is empty or just special characters
            if (!itemName || /^[_\-=*]+$/.test(itemName)) {
                continue;
            }

            // Handle special items (prioritize summary section detection)
            if (lowerLine.includes('subtotal') || lowerLine.includes('sub total') || lowerLine.includes('sub-total')) {
                subtotalAmount = price;
                continue;
            }
            if (lowerLine.match(/^tax\b/) || 
                lowerLine.includes('sales tax') || 
                lowerLine.includes('tax amount') ||
                lowerLine.includes('state tax') ||
                lowerLine.includes('local tax') ||
                lowerLine.includes('city tax') ||
                lowerLine.includes('county tax') ||
                lowerLine.includes('service tax') ||
                lowerLine.includes('hst') ||
                lowerLine.includes('gst') ||
                lowerLine.includes('pst') ||
                lowerLine.includes('vat') ||
                lowerLine.match(/\btax\s*\d+\.?\d*%?/) ||
                lowerLine.match(/\d+\.?\d*%?\s*tax/) ||
                lowerLine.match(/taxes?\s*$/) ||
                lowerLine.match(/^taxes?\b/)) {
                taxAmount = price;
                continue;
            }
            if (lowerLine.includes('service fee') || 
                lowerLine.includes('service charge') || 
                lowerLine.includes('auto gratuity') ||
                lowerLine.includes('auto grat') ||
                lowerLine.includes('service') && lowerLine.includes('fee') ||
                lowerLine.includes('mandatory') && lowerLine.includes('service') ||
                lowerLine.match(/^service\b/) ||
                lowerLine.match(/\bfee\s*$/) && lowerLine.includes('service')) {
                serviceFeeAmount = price;
                continue;
            }
            if (lowerLine.match(/^tip\b/) || lowerLine.includes('gratuity')) {
                tipAmount = price;
                continue;
            }
            if (lowerLine.match(/^total\b/) || lowerLine.includes('grand total') || lowerLine.includes('amount due')) {
                totalAmount = price;
                continue;
            }

            // If we're in the summary section, be more cautious about adding items
            if (isInSummarySection) {
                // Only add as item if it doesn't look like a summary line
                if (!lowerLine.match(/\b(sub|total|tax|tip|gratuity|service|fee|amount|due|balance|change)\b/)) {
                    items.push({
                        id: `item-${items.length + 1}`,
                        name: itemName,
                        price: price
                    });
                }
            } else {
                // Add as regular item (including health mandate and service charge)
                items.push({
                    id: `item-${items.length + 1}`,
                    name: itemName,
                    price: price
                });
            }
        }
    }
    
    // Post-processing: dedicated tax search if not found during main parsing
    if (taxAmount === 0) {
        taxAmount = findTaxAmount(text);
    }
    
    // Calculate missing values if possible
    const calculatedItemsTotal = items.reduce((sum, item) => sum + item.price, 0);
    
    // If we don't have a subtotal, use the sum of items
    if (subtotalAmount === 0) {
        subtotalAmount = calculatedItemsTotal;
    }
    
    // If we have no total but have all components, calculate it
    if (totalAmount === 0 && subtotalAmount > 0) {
        totalAmount = subtotalAmount + taxAmount + serviceFeeAmount + tipAmount;
    }
    
    return {
        items,
        tax: taxAmount,
        serviceFee: serviceFeeAmount,
        tip: tipAmount,
        total: totalAmount
    };
}

/**
 * Dedicated function to search for tax amounts in OCR text
 * This runs as a fallback when tax isn't found during main parsing
 */
function findTaxAmount(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const pricePattern = /\$?\s*(\d+\.?\d{0,2})/; // More flexible - allows whole numbers and decimals
    
    // Multi-line tax parsing - check lines after tax keywords
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        
        // Tax keywords that might appear without amounts on the same line
        const taxKeywords = [
            'sales tax', 'sales taxes', 'tax amount', 'taxes amount', 'state tax', 'state taxes', 
            'local tax', 'local taxes', 'city tax', 'city taxes', 'county tax', 'county taxes', 
            'service tax', 'service taxes', 'hst', 'gst', 'pst', 'vat', 'tax', 'taxes'
        ];
        
        // Check if current line contains tax keyword
        const foundTaxKeyword = taxKeywords.some(keyword => lowerLine.includes(keyword));
        
        if (foundTaxKeyword) {
            // First try to find amount on the same line
            const sameLineMatch = line.match(pricePattern);
            if (sameLineMatch && sameLineMatch[1] !== '0' && sameLineMatch[1] !== '0.00') {
                const amount = parseFloat(sameLineMatch[1]);
                if (amount > 0) {
                    return amount;
                }
            }
            
            // If no amount on same line, check next 2 lines
            for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
                const nextLine = lines[j];
                const nextLineMatch = nextLine.match(pricePattern);
                
                if (nextLineMatch) {
                    const amount = parseFloat(nextLineMatch[1]);
                    // Reasonable tax amount validation (between $0.01 and $999.99)
                    if (amount > 0 && amount < 1000) {
                        return amount;
                    }
                }
            }
        }
    }
    
    // Comprehensive same-line tax patterns (fallback)
    const taxPatterns = [
        /sales\s*tax.*?(\$?\s*\d+\.?\d{0,2})/i,
        /sales\s*taxes.*?(\$?\s*\d+\.?\d{0,2})/i,
        /tax\s*amount.*?(\$?\s*\d+\.?\d{0,2})/i,
        /taxes\s*amount.*?(\$?\s*\d+\.?\d{0,2})/i,
        /state\s*tax.*?(\$?\s*\d+\.?\d{0,2})/i,
        /state\s*taxes.*?(\$?\s*\d+\.?\d{0,2})/i,
        /local\s*tax.*?(\$?\s*\d+\.?\d{0,2})/i,
        /local\s*taxes.*?(\$?\s*\d+\.?\d{0,2})/i,
        /city\s*tax.*?(\$?\s*\d+\.?\d{0,2})/i,
        /city\s*taxes.*?(\$?\s*\d+\.?\d{0,2})/i,
        /county\s*tax.*?(\$?\s*\d+\.?\d{0,2})/i,
        /county\s*taxes.*?(\$?\s*\d+\.?\d{0,2})/i,
        /service\s*tax.*?(\$?\s*\d+\.?\d{0,2})/i,
        /service\s*taxes.*?(\$?\s*\d+\.?\d{0,2})/i,
        /hst.*?(\$?\s*\d+\.?\d{0,2})/i,
        /gst.*?(\$?\s*\d+\.?\d{0,2})/i,
        /pst.*?(\$?\s*\d+\.?\d{0,2})/i,
        /vat.*?(\$?\s*\d+\.?\d{0,2})/i,
        /(\$?\s*\d+\.?\d{0,2}).*?tax/i,
        /(\$?\s*\d+\.?\d{0,2}).*?taxes/i,
        /tax.*?(\$?\s*\d+\.?\d{0,2})/i,
        /taxes.*?(\$?\s*\d+\.?\d{0,2})/i
    ];
    
    // Search entire text for same-line patterns
    const fullText = text.toLowerCase();
    for (const pattern of taxPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            const priceMatch = match[1].match(/(\d+\.?\d{0,2})/);
            if (priceMatch) {
                const amount = parseFloat(priceMatch[1]);
                if (amount > 0) {
                    return amount;
                }
            }
        }
    }
    
    return 0;
}