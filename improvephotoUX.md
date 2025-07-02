# Photo UX Improvements Plan

## Issues to Fix

### 1. White Rectangle Frame Height
**Problem**: The white rectangle frame is not tall enough for receipts
**Solution**: 
- Change frame dimensions from 80% width � 60% height to 70% width � 75% height
- Receipts are typically taller than they are wide (aspect ratio ~2:1 to 3:1)
- This will provide better guidance for receipt positioning

### 2. Mobile Button Cutoff
**Problem**: "Capture photo" and "cancel" buttons are cut off by bottom of browser on mobile
**Solutions**:
- Add `padding-bottom: env(safe-area-inset-bottom)` for iOS notch/home indicator
- Reduce camera controls padding from 20px to 10px on mobile
- Use `vh` units more carefully - ensure controls stay within viewport
- Add media query for mobile devices to adjust button positioning
- Consider making buttons position: fixed with proper bottom spacing

### 3. Instruction Text Positioning
**Problem**: "Position receipt inside frame" text appears inside the white box outline
**Solution**:
- Move instruction text to position above the frame instead of centered
- Change from `top: 20%` to `top: 10%` 
- Ensure adequate spacing between instruction text and frame top edge
- Frame should start around `top: 15%` to leave room for instruction

## Implementation Plan

### CSS Changes Required:

1. **Update `.receipt-frame-guide`**:
   - Change `width: 80%` � `width: 70%`
   - Change `height: 60%` � `height: 75%`

2. **Update `.camera-instruction`**:
   - Change `top: 20%` � `top: 10%`
   - Ensure proper spacing above frame

3. **Update `.camera-overlay`**:
   - Adjust positioning to accommodate new instruction placement
   - Ensure frame is properly centered with instruction above

4. **Add Gaussian Blur Effect Outside Frame**:
   - Create a blur overlay that covers the entire camera view
   - Use CSS `backdrop-filter: blur()` or layered div approach
   - Apply blur effect to areas outside the white rectangle frame
   - Options for implementation:
     - **Method 1**: Use `backdrop-filter: blur(3px)` on overlay divs positioned around the frame
     - **Method 2**: Create 4 separate divs (top, bottom, left, right) with blur effect
     - **Method 3**: Use CSS mask with blur filter on a full overlay
   - Blur strength: ~2-4px for subtle effect that doesn't distract
   - Ensure blur doesn't affect the instruction text or frame border

5. **Add Mobile Responsive CSS**:
   - Add media query for mobile devices (`@media (max-width: 768px)`)
   - Reduce camera controls padding on mobile
   - Add safe area insets for iOS devices
   - Potentially use `position: fixed` for controls with proper bottom spacing

6. **Update `.camera-controls`**:
   - Add `padding-bottom: env(safe-area-inset-bottom)` for iOS
   - Reduce padding on mobile: `padding: 10px 20px`
   - Ensure buttons stay within viewport bounds

## Testing Considerations
- Test on various mobile devices (iOS Safari, Android Chrome)
- Verify instruction text doesn't overlap with frame
- Confirm buttons are accessible on all screen sizes
- Check that frame dimensions work well for typical receipt aspect ratios
- Ensure safe area insets work properly on newer iPhones
- Test blur effect performance on older devices
- Verify blur effect doesn't impact camera performance or battery usage significantly
- Ensure blur boundary aligns properly with frame edges