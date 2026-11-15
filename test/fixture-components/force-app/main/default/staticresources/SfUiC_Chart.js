// SFUIC canvas chart: draws one bar per value on a canvas element.
window.sfuicDrawBars = function (canvas, values) {
    const ctx = canvas.getContext('2d');
    const max = Math.max.apply(null, values);
    const w = canvas.width / values.length;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    values.forEach(function (v, i) {
        const h = (v / max) * (canvas.height - 10);
        ctx.fillStyle = '#0176d3';
        ctx.fillRect(i * w + 5, canvas.height - h, w - 10, h);
    });
};
