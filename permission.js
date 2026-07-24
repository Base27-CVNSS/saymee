const button = document.querySelector('#grant');
const status = document.querySelector('#status');

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = 'Đang yêu cầu quyền…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
    status.textContent = 'Đã cấp quyền. Có thể đóng tab này và quay lại extension.';
  } catch (error) {
    status.textContent = `Không cấp được quyền: ${error.message}`;
    button.disabled = false;
  }
});
