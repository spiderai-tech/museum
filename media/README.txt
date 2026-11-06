Frame pictures and videos (auto-loaded)

Put a file in this folder named after the frame number:
  frame1.jpg   -> the 1st frame in the museum
  frame2.png   -> the 2nd frame
  frame3.mp4   -> the 3rd frame (video, plays muted and loops)

Allowed types: jpg, jpeg, png, webp, gif, mp4, webm.
Frames with no file keep the normal empty placeholder.

Priority:
  1. Changes made while the museum is open (Change / New / Remove) and synced from Firebase
  2. Files in this folder
  3. Empty placeholder

Important: auto-loading works only when the museum is opened from a web address
(your hosting, or a local server such as "python -m http.server" in this folder).
Opening index.html directly from the disk (file://) cannot read this folder.
