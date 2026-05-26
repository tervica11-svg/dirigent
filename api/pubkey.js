module.exports = (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICHnPXnxhPhqNaHZLWYwdZQqE7M8KXe7idWJoKu0qvNr go-agent\n');
};
