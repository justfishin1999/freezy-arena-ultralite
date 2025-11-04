 function isValidIPv4(ip) {
      const regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      if (!regex.test(ip)) return false;
      return ip.split('.').every(octet => {
          const num = parseInt(octet, 10);
          return num >= 0 && num <= 255 && octet === num.toString();
      });
    }

    function updateApLink(ip) {
      const link = document.getElementById('ap_link');
      const cleanIp = ip.trim();

      if (cleanIp && isValidIPv4(cleanIp)) {
          link.href = `http://${cleanIp}`;
          link.textContent = `Open http://${cleanIp}`;
          link.style.display = 'inline-block';
      } else {
          link.style.display = 'none';
      }
    }

    // Initialize on page load if value is pre-filled
    document.addEventListener('DOMContentLoaded', () => {
      const input = document.getElementById('ap_ip');
      if (input.value) {
          updateApLink(input.value);
      }
    });