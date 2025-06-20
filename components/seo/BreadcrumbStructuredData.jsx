export default function BreadcrumbStructuredData({ 
  items = [],
  currentPage = "Home"
}) {
  // Default breadcrumb for homepage
  const defaultItems = [
    {
      "@type": "ListItem",
      "position": 1,
      "name": "Home",
      "item": "https://www.gioiabeauty.net/"
    }
  ];

  // Build breadcrumb items
  let breadcrumbItems = [...defaultItems];
  
  if (items.length > 0) {
    items.forEach((item, index) => {
      breadcrumbItems.push({
        "@type": "ListItem",
        "position": index + 2,
        "name": item.name,
        "item": item.url
      });
    });
  }

  // Add current page if it's not home
  if (currentPage !== "Home") {
    breadcrumbItems.push({
      "@type": "ListItem",
      "position": breadcrumbItems.length + 1,
      "name": currentPage
    });
  }

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": breadcrumbItems
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData, null, 2),
      }}
    />
  );
}