const reveals = [...document.querySelectorAll(".reveal")];
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  for (const element of reveals) observer.observe(element);
} else {
  for (const element of reveals) element.classList.add("is-visible");
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

const menu = document.querySelector(".mobile-menu");
if (menu) {
  for (const link of menu.querySelectorAll("a")) {
    link.addEventListener("click", () => menu.removeAttribute("open"));
  }
}
