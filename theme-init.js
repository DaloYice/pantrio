// Theme-Bootstrap (must run before app.css applies, prevents FOUC).
// Standalone-Script, damit `script-src 'self'` ohne 'unsafe-inline' möglich ist.
(function(){
  try {
    var saved = localStorage.getItem('pantrio.theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {}
})();
